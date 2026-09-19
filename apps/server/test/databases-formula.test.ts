/**
 * 自研公式引擎的測試（04 §8 M4 交付物 4）。
 * 引擎本身在 packages/shared-types/src/formula/（前後端共用同一份），
 * 這裡連同「schema → 求值」的整條路徑一起測。
 *
 * 最後一段是 property test：隨機生成運算式樹，驗證
 *   parse(print(ast)) 與 ast 求值結果一致（parser 與求值器互為對照）。
 */
import { describe, expect, it } from 'vitest';
import type { CollectionSchema, FormulaAst, FormulaValue } from '@kennote/shared-types';
import {
  FormulaError,
  compileFormula,
  detectFormulaCycles,
  evaluateFormula,
  findSchemaFormulaCycles,
  parseFormula,
  schemaPropertyResolver,
  tokenize,
} from '@kennote/shared-types';
import { computeRowProperties } from '../src/modules/databases/computed.js';
import '../src/modules/databases/field-types/index.js';

const NOW = new Date('2026-09-19T00:00:00Z');

function evalExpr(expression: string, schema: CollectionSchema = {}, props = {}): FormulaValue {
  const compiled = compileFormula(expression, schemaPropertyResolver(schema));
  return evaluateFormula(compiled.ast, {
    now: NOW,
    getProperty: (id) => (props as Record<string, FormulaValue>)[id] ?? null,
  });
}

describe('tokenizer', () => {
  it('切出數字 / 字串 / 識別字 / 運算子', () => {
    const kinds = tokenize('if(prop("a") > 1.5, "yes", \'no\')').map((t) => t.kind);
    expect(kinds).toContain('number');
    expect(kinds).toContain('string');
    expect(kinds).toContain('ident');
    expect(kinds).toContain('operator');
    expect(kinds[kinds.length - 1]).toBe('eof');
  });

  it('沒收尾的字串會報錯，而且指出位置', () => {
    try {
      tokenize('concat("abc');
      throw new Error('應該要丟錯');
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaError);
      expect((err as FormulaError).code).toBe('SYNTAX');
      expect((err as FormulaError).position).toBe(7);
    }
  });

  it('&& || <> 會正規化成 and / or / !=', () => {
    expect(tokenize('a && b || c <> d').filter((t) => t.kind === 'operator').map((t) => t.value)).toEqual([
      'and',
      'or',
      '!=',
    ]);
  });
});

describe('parser（Pratt）', () => {
  it('乘除優先於加減', () => {
    expect(evalExpr('1 + 2 * 3')).toBe(7);
  });

  it('括號可以改變優先級', () => {
    expect(evalExpr('(1 + 2) * 3')).toBe(9);
  });

  it('^ 是右結合', () => {
    expect(evalExpr('2 ^ 3 ^ 2')).toBe(512);
  });

  it('一元負號', () => {
    expect(evalExpr('-3 + 1')).toBe(-2);
  });

  it('比較與邏輯', () => {
    expect(evalExpr('1 < 2 and 3 >= 3')).toBe(true);
    expect(evalExpr('1 > 2 or not(false)')).toBe(true);
  });

  it('結尾多餘的 token 會報錯', () => {
    expect(() => parseFormula('1 + 2 3')).toThrow(FormulaError);
  });

  it('空運算式會報錯', () => {
    expect(() => parseFormula('   ')).toThrow(FormulaError);
  });
});

describe('內建函式', () => {
  it('if / concat / length', () => {
    expect(evalExpr('if(1 > 0, "大", "小")')).toBe('大');
    expect(evalExpr('concat("a", "b", 1)')).toBe('ab1');
    expect(evalExpr('length("哈囉世界")')).toBe(4);
  });

  it('toNumber / round / abs', () => {
    expect(evalExpr('toNumber("1,250")')).toBe(1250);
    expect(evalExpr('round(3.14159, 2)')).toBe(3.14);
    expect(evalExpr('abs(0 - 7)')).toBe(7);
  });

  it('now / dateAdd / dateBetween / formatDate', () => {
    expect(evalExpr('formatDate(now(), "YYYY/MM/DD")')).toBe('2026/09/19');
    expect(evalExpr('formatDate(dateAdd(now(), 1, "month"), "YYYY-MM-DD")')).toBe('2026-10-19');
    expect(evalExpr('dateBetween(dateAdd(now(), 10, "days"), now(), "days")')).toBe(10);
  });

  it('empty / contains / replace / slice / join', () => {
    expect(evalExpr('empty("")')).toBe(true);
    expect(evalExpr('contains("kennote", "note")')).toBe(true);
    expect(evalExpr('replace("a-b-c", "-", "+")')).toBe('a+b+c');
    expect(evalExpr('slice("abcdef", 1, 3)')).toBe('bc');
    expect(evalExpr('join("/", "a", "b")')).toBe('a/b');
  });

  it('除以零會是可讀的錯誤而不是 Infinity', () => {
    expect(() => evalExpr('1 / 0')).toThrow(FormulaError);
  });

  it('未知函式 → UNKNOWN_FUNCTION', () => {
    try {
      evalExpr('nosuchfn(1)');
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as FormulaError).code).toBe('UNKNOWN_FUNCTION');
    }
  });

  it('參數數量不對 → ARITY', () => {
    try {
      evalExpr('round()');
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as FormulaError).code).toBe('ARITY');
    }
  });
});

describe('型別檢查', () => {
  const schema: CollectionSchema = {
    title: { name: '名稱', type: 'title' },
    Num1: { name: '預算', type: 'number' },
    Chk1: { name: '完成', type: 'checkbox' },
    Dat1: { name: '截止日', type: 'date' },
  };

  it('prop() 用名稱寫，編譯成穩定的 propertyId', () => {
    const compiled = compileFormula('prop("預算") * 2', schemaPropertyResolver(schema));
    expect(compiled.dependsOn).toEqual(['Num1']);
    expect(compiled.resultType).toBe('number');
  });

  it('裸識別字也能當欄位參照', () => {
    expect(compileFormula('預算 + 1', schemaPropertyResolver(schema)).dependsOn).toEqual(['Num1']);
  });

  it('找不到欄位 → UNKNOWN_PROPERTY', () => {
    try {
      compileFormula('prop("不存在")', schemaPropertyResolver(schema));
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as FormulaError).code).toBe('UNKNOWN_PROPERTY');
    }
  });

  it('布林欄位不能做四則運算 → TYPE', () => {
    try {
      compileFormula('prop("完成") * 2', schemaPropertyResolver(schema));
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as FormulaError).code).toBe('TYPE');
    }
  });

  it('日期不能直接加減，訊息會提示改用 dateAdd', () => {
    try {
      compileFormula('prop("截止日") + 1', schemaPropertyResolver(schema));
      throw new Error('應該要丟錯');
    } catch (err) {
      expect((err as FormulaError).message).toContain('dateAdd');
    }
  });

  it('dateBetween 的回傳型別是 number', () => {
    const compiled = compileFormula(
      'dateBetween(prop("截止日"), now(), "days")',
      schemaPropertyResolver(schema),
    );
    expect(compiled.resultType).toBe('number');
  });
});

describe('循環引用偵測', () => {
  it('直接互相引用會被抓到', () => {
    const cycles = detectFormulaCycles({ a: ['b'], b: ['a'] });
    expect(cycles.length).toBe(1);
  });

  it('自我引用會被抓到', () => {
    expect(detectFormulaCycles({ a: ['a'] }).length).toBe(1);
  });

  it('三層環會被抓到', () => {
    expect(detectFormulaCycles({ a: ['b'], b: ['c'], c: ['a'] }).length).toBe(1);
  });

  it('DAG 不會誤判', () => {
    expect(detectFormulaCycles({ a: ['b', 'c'], b: ['c'], c: [] })).toEqual([]);
  });

  it('schema 層級回傳的是欄位名稱（直接給使用者看）', () => {
    const schema: CollectionSchema = {
      title: { name: '名稱', type: 'title' },
      Fa: { name: 'A', type: 'formula', expression: '', ast: null, resultType: 'any', dependsOn: ['Fb'] },
      Fb: { name: 'B', type: 'formula', expression: '', ast: null, resultType: 'any', dependsOn: ['Fa'] },
    };
    const cycles = findSchemaFormulaCycles(schema);
    expect(cycles[0]).toContain('A');
    expect(cycles[0]).toContain('B');
  });
});

describe('整列求值（computeRowProperties）', () => {
  const schema: CollectionSchema = {
    title: { name: '名稱', type: 'title' },
    Num1: { name: '預算', type: 'number' },
    Dat1: { name: '截止日', type: 'date' },
    Ct1: { name: '建立時間', type: 'createdTime' },
    Cb1: { name: '建立者', type: 'createdBy' },
    Fm1: {
      name: '含稅',
      type: 'formula',
      expression: 'round(prop("預算") * 1.05)',
      ast: {
        op: 'fn',
        name: 'round',
        args: [
          {
            op: 'binary',
            operator: '*',
            left: { op: 'prop', propertyId: 'Num1' },
            right: { op: 'lit', value: 1.05 },
          },
        ],
      },
      resultType: 'number',
      dependsOn: ['Num1'],
    },
  };

  const meta = {
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    createdBy: 'user-1',
    updatedBy: 'user-2',
  };

  it('系統欄位由 pages 的實體欄位投影', () => {
    const out = computeRowProperties(schema, {}, meta, new Map(), NOW);
    expect(out.Ct1).toEqual({ type: 'createdTime', start: meta.createdAt });
    expect(out.Cb1).toEqual({ type: 'createdBy', userIds: ['user-1'] });
  });

  it('formula 會被算出來', () => {
    const out = computeRowProperties(
      schema,
      { Num1: { type: 'number', number: 100 } },
      meta,
      new Map(),
      NOW,
    );
    expect(out.Fm1).toMatchObject({ type: 'formula', value: 105, error: null });
  });

  it('相依欄位是空的時候結果是空值，不是 NaN', () => {
    const out = computeRowProperties(schema, {}, meta, new Map(), NOW);
    expect(out.Fm1).toMatchObject({ type: 'formula', value: null });
  });

  it('公式錯誤只影響那一格，不會讓整列查詢失敗', () => {
    const broken: CollectionSchema = {
      ...schema,
      Fm1: { ...(schema.Fm1 as unknown as Record<string, unknown>), ast: null, error: '公式尚未設定' } as never,
    };
    const out = computeRowProperties(broken, {}, meta, new Map(), NOW);
    expect((out.Fm1 as { error?: string }).error).toBeTruthy();
  });
});

/* ── property test ─────────────────────────────────────── */

/** 小型 LCG：固定種子 → 可重現的隨機，測試失敗時能重跑同一組輸入 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomAst(rand: () => number, depth: number): FormulaAst {
  if (depth <= 0 || rand() < 0.3) {
    return { op: 'lit', value: Math.floor(rand() * 20) - 10 };
  }
  const operators = ['+', '-', '*'] as const;
  const op = operators[Math.floor(rand() * operators.length)] as '+' | '-' | '*';
  return {
    op: 'binary',
    operator: op,
    left: randomAst(rand, depth - 1),
    right: randomAst(rand, depth - 1),
  };
}

/** AST → 運算式字串（一律加括號，語意不會被優先級改掉） */
function printAst(ast: FormulaAst): string {
  switch (ast.op) {
    case 'lit':
      return typeof ast.value === 'number' && ast.value < 0 ? `(0 - ${-ast.value})` : String(ast.value);
    case 'binary':
      return `(${printAst(ast.left)} ${ast.operator} ${printAst(ast.right)})`;
    default:
      return '0';
  }
}

function evalAst(ast: FormulaAst): number {
  if (ast.op === 'lit') return Number(ast.value);
  if (ast.op === 'binary') {
    const a = evalAst(ast.left);
    const b = evalAst(ast.right);
    return ast.operator === '+' ? a + b : ast.operator === '-' ? a - b : a * b;
  }
  return 0;
}

describe('property test：parse(print(ast)) 與參考實作等價', () => {
  it('200 組隨機運算式樹', () => {
    const rand = makeRandom(20260919);
    for (let i = 0; i < 200; i += 1) {
      const ast = randomAst(rand, 4);
      const source = printAst(ast);
      const parsed = parseFormula(source);
      const actual = evaluateFormula(parsed, { now: NOW, getProperty: () => null });
      expect({ source, value: actual }).toEqual({ source, value: evalAst(ast) });
    }
  });

  it('隨機運算式的求值不會丟出非 FormulaError 的例外', () => {
    const rand = makeRandom(7);
    for (let i = 0; i < 200; i += 1) {
      const source = printAst(randomAst(rand, 3));
      expect(() => evaluateFormula(parseFormula(source), { now: NOW, getProperty: () => null })).not.toThrow();
    }
  });

  it('加法交換律：a + b == b + a（100 組）', () => {
    const rand = makeRandom(99);
    for (let i = 0; i < 100; i += 1) {
      const a = printAst(randomAst(rand, 2));
      const b = printAst(randomAst(rand, 2));
      const left = evaluateFormula(parseFormula(`${a} + ${b}`), { now: NOW, getProperty: () => null });
      const right = evaluateFormula(parseFormula(`${b} + ${a}`), { now: NOW, getProperty: () => null });
      expect(left).toBe(right);
    }
  });
});
