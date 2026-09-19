/**
 * 編譯：運算式字串 → { ast, resultType, dependsOn }。
 *
 * 三件事在這裡一次做完，之後求值就不必再碰 schema：
 *   1. `prop("名稱")` / 裸識別字 → 穩定的 propertyId（03 §4.6：名稱會改，id 不會）
 *   2. 型別檢查（number / string / boolean / date）
 *   3. 收集 dependsOn，交給 detectFormulaCycles 做循環引用偵測
 */
import {
  FormulaError,
  type BinaryOperator,
  type FormulaAst,
  type FormulaType,
} from './ast.js';
import { getFormulaFunction } from './functions.js';
import { parseFormula } from './parser.js';

export interface PropertyResolution {
  propertyId: string;
  type: FormulaType;
}

/** 由呼叫端提供：把 prop("…") 裡的名稱或 id 解析成 { propertyId, type } */
export type PropertyResolver = (nameOrId: string) => PropertyResolution | null;

export interface CompiledFormula {
  ast: FormulaAst;
  resultType: FormulaType;
  /** 相依的 propertyId（去重、穩定排序），供循環引用偵測與增量重算用 */
  dependsOn: string[];
}

const ARITHMETIC: BinaryOperator[] = ['+', '-', '*', '/', '%', '^'];
const COMPARISON: BinaryOperator[] = ['==', '!=', '>', '<', '>=', '<='];

/** 型別相容表。刻意保留一點寬鬆度（字串→數字這種使用者一定會寫），但不是全開 */
function isAssignable(from: FormulaType, to: FormulaType): boolean {
  if (to === 'any' || from === 'any') return true;
  if (to === 'string') return true; // 任何值都能轉成文字
  if (to === 'boolean') return true; // 任何值都有真假值
  if (to === 'number') return from === 'number' || from === 'string';
  if (to === 'date') return from === 'date' || from === 'string' || from === 'number';
  return from === to;
}

function typeName(t: FormulaType): string {
  return { number: '數字', string: '文字', boolean: '是/否', date: '日期', any: '任意' }[t];
}

interface Ctx {
  resolve: PropertyResolver;
  deps: Set<string>;
  depth: number;
}

const MAX_DEPTH = 40;

function compileNode(node: FormulaAst, ctx: Ctx): { ast: FormulaAst; type: FormulaType } {
  if (ctx.depth > MAX_DEPTH) throw new FormulaError('SYNTAX', '運算式巢狀過深');
  const child: Ctx = { ...ctx, depth: ctx.depth + 1 };

  switch (node.op) {
    case 'lit': {
      const v = node.value;
      const type: FormulaType =
        v === null
          ? 'any'
          : typeof v === 'number'
            ? 'number'
            : typeof v === 'boolean'
              ? 'boolean'
              : 'string';
      return { ast: node, type };
    }

    case 'prop': {
      const resolved = ctx.resolve(node.propertyId);
      if (!resolved) {
        throw new FormulaError('UNKNOWN_PROPERTY', '找不到欄位「' + node.propertyId + '」');
      }
      ctx.deps.add(resolved.propertyId);
      return {
        ast: { op: 'prop', propertyId: resolved.propertyId, name: node.name ?? node.propertyId },
        type: resolved.type,
      };
    }

    case 'unary': {
      const arg = compileNode(node.arg, child);
      if (node.operator === '-') {
        if (!isAssignable(arg.type, 'number')) {
          throw new FormulaError('TYPE', '負號只能用在數字上，這裡是' + typeName(arg.type));
        }
        return { ast: { op: 'unary', operator: '-', arg: arg.ast }, type: 'number' };
      }
      return { ast: { op: 'unary', operator: 'not', arg: arg.ast }, type: 'boolean' };
    }

    case 'binary': {
      const left = compileNode(node.left, child);
      const right = compileNode(node.right, child);
      const ast: FormulaAst = {
        op: 'binary',
        operator: node.operator,
        left: left.ast,
        right: right.ast,
      };

      if (node.operator === 'and' || node.operator === 'or') {
        return { ast, type: 'boolean' };
      }
      if (COMPARISON.includes(node.operator)) {
        return { ast, type: 'boolean' };
      }
      if (ARITHMETIC.includes(node.operator)) {
        // 兩邊都是文字時，+ 當作串接（使用者最常犯的錯，直接支援比報錯好）
        if (node.operator === '+' && left.type === 'string' && right.type === 'string') {
          return { ast, type: 'string' };
        }
        // 日期 + 數字沒有定義，請用 dateAdd()
        if (left.type === 'date' || right.type === 'date') {
          throw new FormulaError('TYPE', '日期不能直接做四則運算，請用 dateAdd() 或 dateBetween()');
        }
        for (const side of [left, right]) {
          if (!isAssignable(side.type, 'number')) {
            throw new FormulaError(
              'TYPE',
              '運算子「' + node.operator + '」需要數字，這裡是' + typeName(side.type),
            );
          }
        }
        return { ast, type: 'number' };
      }
      throw new FormulaError('SYNTAX', '不支援的運算子「' + node.operator + '」');
    }

    case 'fn': {
      // prop("名稱") 是唯一的特例：參數必須是字面字串，才能在編譯期算出 dependsOn
      if (node.name.toLowerCase() === 'prop') {
        const first = node.args[0];
        if (node.args.length !== 1 || !first || first.op !== 'lit' || typeof first.value !== 'string') {
          throw new FormulaError('SYNTAX', 'prop() 的參數必須是欄位名稱字串，例如 prop("狀態")');
        }
        return compileNode({ op: 'prop', propertyId: first.value, name: first.value }, child);
      }

      const def = getFormulaFunction(node.name);
      if (!def) throw new FormulaError('UNKNOWN_FUNCTION', '沒有這個函式：' + node.name + '()');
      if (node.args.length < def.minArgs || node.args.length > def.maxArgs) {
        throw new FormulaError(
          'ARITY',
          def.signature + ' 需要 ' + def.minArgs + '～' + def.maxArgs + ' 個參數，收到 ' + node.args.length + ' 個',
        );
      }

      const compiled = node.args.map((a) => compileNode(a, child));
      compiled.forEach((arg, i) => {
        const expected = def.params[i] ?? def.restParam ?? 'any';
        if (!isAssignable(arg.type, expected)) {
          throw new FormulaError(
            'TYPE',
            def.name + '() 的第 ' + (i + 1) + ' 個參數要' + typeName(expected) + '，這裡是' + typeName(arg.type),
          );
        }
      });

      const argTypes = compiled.map((c) => c.type);
      const type = typeof def.returns === 'function' ? def.returns(argTypes) : def.returns;
      return { ast: { op: 'fn', name: def.name, args: compiled.map((c) => c.ast) }, type };
    }

    default:
      throw new FormulaError('SYNTAX', '看不懂的節點');
  }
}

export function compileFormula(expression: string, resolve: PropertyResolver): CompiledFormula {
  const parsed = parseFormula(expression);
  const deps = new Set<string>();
  const { ast, type } = compileNode(parsed, { resolve, deps, depth: 0 });
  return { ast, resultType: type, dependsOn: [...deps].sort() };
}

/** 已經有 AST（從 schema 讀回來）時，重新驗證並補回 dependsOn */
export function recompileAst(ast: FormulaAst, resolve: PropertyResolver): CompiledFormula {
  const deps = new Set<string>();
  const out = compileNode(ast, { resolve, deps, depth: 0 });
  return { ast: out.ast, resultType: out.type, dependsOn: [...deps].sort() };
}

/**
 * 循環引用偵測。輸入 propertyId → 它相依的 propertyId[]；
 * 回傳所有找到的環（每個環是一串 propertyId，首尾相同）。
 *
 * 公式欄位互相引用時，求值會無窮遞迴 —— 04 §8 M4 驗收標準明列此項。
 */
export function detectFormulaCycles(graph: Record<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>(); // 0=未訪 1=堆疊中 2=完成
  const stack: string[] = [];

  function visit(node: string): void {
    const s = state.get(node) ?? 0;
    if (s === 1) {
      const start = stack.indexOf(node);
      const cycle = [...stack.slice(start), node];
      const fingerprint = [...cycle].sort().join('>');
      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        cycles.push(cycle);
      }
      return;
    }
    if (s === 2) return;
    state.set(node, 1);
    stack.push(node);
    for (const next of graph[node] ?? []) visit(next);
    stack.pop();
    state.set(node, 2);
  }

  for (const node of Object.keys(graph)) visit(node);
  return cycles;
}
