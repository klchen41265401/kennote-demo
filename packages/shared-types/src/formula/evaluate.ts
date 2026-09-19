/**
 * 求值器。輸入已編譯的 AST + 一列的欄位值，輸出 FormulaValue。
 *
 * 保證：
 * - 不會無窮迴圈（步數上限；循環引用在 compile 階段已被 detectFormulaCycles 擋掉）
 * - 任何錯誤都是 FormulaError（訊息可直接顯示在儲存格上）
 */
import { FormulaError, type FormulaAst, type FormulaValue } from './ast.js';
import {
  getFormulaFunction,
  toBooleanValue,
  toNumberValue,
  toStringValue,
} from './functions.js';

export interface EvalContext {
  /** 取某個欄位在這一列的值（已轉成 FormulaValue） */
  getProperty(propertyId: string): FormulaValue;
  /** now() 的固定時間點：同一次查詢裡所有列必須拿到同一個 now，否則排序會抖動 */
  now: Date;
}

const MAX_STEPS = 10_000;

function compareValues(a: FormulaValue, b: FormulaValue): number {
  if (a instanceof Date || b instanceof Date) {
    const x = a instanceof Date ? a.getTime() : (toNumberValue(a) ?? Number.NaN);
    const y = b instanceof Date ? b.getTime() : (toNumberValue(b) ?? Number.NaN);
    return x === y ? 0 : x < y ? -1 : 1;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const x = toNumberValue(a);
    const y = toNumberValue(b);
    if (x === null || y === null) return Number.NaN;
    return x === y ? 0 : x < y ? -1 : 1;
  }
  const x = toStringValue(a);
  const y = toStringValue(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function looseEquals(a: FormulaValue, b: FormulaValue): boolean {
  if (a === null || b === null) return a === b;
  const cmp = compareValues(a, b);
  return cmp === 0;
}

export function evaluateFormula(ast: FormulaAst, ctx: EvalContext): FormulaValue {
  let steps = 0;

  function walk(node: FormulaAst): FormulaValue {
    steps += 1;
    if (steps > MAX_STEPS) throw new FormulaError('RUNTIME', '公式太複雜，已中止計算');

    switch (node.op) {
      case 'lit':
        return node.value;

      case 'prop':
        return ctx.getProperty(node.propertyId);

      case 'unary': {
        if (node.operator === 'not') return !toBooleanValue(walk(node.arg));
        const n = toNumberValue(walk(node.arg));
        return n === null ? null : -n;
      }

      case 'binary': {
        // 短路求值：and/or 不求值右側
        if (node.operator === 'and') {
          return toBooleanValue(walk(node.left)) ? toBooleanValue(walk(node.right)) : false;
        }
        if (node.operator === 'or') {
          return toBooleanValue(walk(node.left)) ? true : toBooleanValue(walk(node.right));
        }

        const left = walk(node.left);
        const right = walk(node.right);

        switch (node.operator) {
          case '==':
            return looseEquals(left, right);
          case '!=':
            return !looseEquals(left, right);
          case '>':
            return compareValues(left, right) > 0;
          case '<':
            return compareValues(left, right) < 0;
          case '>=':
            return compareValues(left, right) >= 0;
          case '<=':
            return compareValues(left, right) <= 0;
          default:
            break;
        }

        if (node.operator === '+' && typeof left === 'string' && typeof right === 'string') {
          return left + right;
        }

        const a = toNumberValue(left);
        const b = toNumberValue(right);
        // 任一邊是空值 → 結果是空值（跟 SQL 的 NULL 傳染一致，也跟 Notion 一致）
        if (a === null || b === null) return null;

        switch (node.operator) {
          case '+':
            return a + b;
          case '-':
            return a - b;
          case '*':
            return a * b;
          case '/':
            if (b === 0) throw new FormulaError('RUNTIME', '除以零');
            return a / b;
          case '%':
            if (b === 0) throw new FormulaError('RUNTIME', '除以零');
            return a % b;
          case '^':
            return a ** b;
          default:
            throw new FormulaError('RUNTIME', '不支援的運算子「' + node.operator + '」');
        }
      }

      case 'fn': {
        if (node.name.toLowerCase() === 'now') return ctx.now;
        const def = getFormulaFunction(node.name);
        if (!def) throw new FormulaError('UNKNOWN_FUNCTION', '沒有這個函式：' + node.name + '()');
        return def.impl(node.args.map(walk));
      }

      default:
        throw new FormulaError('RUNTIME', '看不懂的節點');
    }
  }

  return walk(ast);
}

/** 把求值結果變成可以存進 JSONB 的形狀（Date → ISO 字串） */
export function serializeFormulaValue(v: FormulaValue): string | number | boolean | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}
