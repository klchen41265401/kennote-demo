/**
 * Pratt parser（運算子優先級由 binding power 決定，不用一層一層的遞迴下降函式）。
 * 產出的 AST 與 03 §6.3 的 formula.ast 形狀一致，可以直接存進 collection schema。
 */
import { FormulaError, type BinaryOperator, type FormulaAst, type Token } from './ast.js';
import { tokenize } from './tokenizer.js';

/** 中綴運算子的 (左, 右) binding power。右結合的運算子右側 bp 比左側小 */
const INFIX: Record<string, [number, number]> = {
  or: [1, 2],
  and: [3, 4],
  '==': [5, 6],
  '!=': [5, 6],
  '>': [7, 8],
  '<': [7, 8],
  '>=': [7, 8],
  '<=': [7, 8],
  '+': [9, 10],
  '-': [9, 10],
  '*': [11, 12],
  '/': [11, 12],
  '%': [11, 12],
  '^': [16, 15], // 右結合
};

const PREFIX_BP = 13;

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] as Token;
  }
  private next(): Token {
    const t = this.tokens[this.pos] as Token;
    if (t.kind !== 'eof') this.pos += 1;
    return t;
  }
  private expect(kind: Token['kind'], what: string): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new FormulaError('SYNTAX', `這裡應該要有${what}`, t.start);
    }
    return this.next();
  }

  parseExpression(minBp = 0): FormulaAst {
    let left = this.parsePrefix();

    for (;;) {
      const t = this.peek();
      if (t.kind !== 'operator') break;
      const bp = INFIX[t.value];
      if (!bp || bp[0] < minBp) break;
      this.next();
      const right = this.parseExpression(bp[1]);
      left = { op: 'binary', operator: t.value as BinaryOperator, left, right };
    }
    return left;
  }

  private parsePrefix(): FormulaAst {
    const t = this.next();

    switch (t.kind) {
      case 'number': {
        const n = Number(t.value);
        if (!Number.isFinite(n)) throw new FormulaError('SYNTAX', `不合法的數字「${t.value}」`, t.start);
        return { op: 'lit', value: n };
      }
      case 'string':
        return { op: 'lit', value: t.value };
      case 'lparen': {
        const inner = this.parseExpression(0);
        this.expect('rparen', '右括號 )');
        return inner;
      }
      case 'operator': {
        if (t.value === '-') return { op: 'unary', operator: '-', arg: this.parseExpression(PREFIX_BP) };
        if (t.value === 'not') return { op: 'unary', operator: 'not', arg: this.parseExpression(PREFIX_BP) };
        if (t.value === '+') return this.parseExpression(PREFIX_BP);
        throw new FormulaError('SYNTAX', `運算子「${t.value}」不能放在運算式開頭`, t.start);
      }
      case 'ident': {
        const lower = t.value.toLowerCase();
        if (lower === 'true') return { op: 'lit', value: true };
        if (lower === 'false') return { op: 'lit', value: false };
        if (lower === 'null' || lower === 'empty_value') return { op: 'lit', value: null };

        if (this.peek().kind === 'lparen') {
          this.next();
          const args: FormulaAst[] = [];
          if (this.peek().kind !== 'rparen') {
            for (;;) {
              args.push(this.parseExpression(0));
              if (this.peek().kind === 'comma') {
                this.next();
                continue;
              }
              break;
            }
          }
          this.expect('rparen', '右括號 )');
          return { op: 'fn', name: t.value, args };
        }
        // 裸識別字 = 欄位參照的簡寫，compile 階段再解析成 propertyId
        return { op: 'fn', name: 'prop', args: [{ op: 'lit', value: t.value }] };
      }
      default:
        throw new FormulaError('SYNTAX', t.kind === 'eof' ? '運算式不完整' : '看不懂的語法', t.start);
    }
  }

  parseProgram(): FormulaAst {
    if (this.peek().kind === 'eof') throw new FormulaError('SYNTAX', '運算式是空的', 0);
    const ast = this.parseExpression(0);
    const rest = this.peek();
    if (rest.kind !== 'eof') {
      throw new FormulaError('SYNTAX', `運算式結尾多了「${rest.value}」`, rest.start);
    }
    return ast;
  }
}

export function parseFormula(expression: string): FormulaAst {
  return new Parser(tokenize(expression)).parseProgram();
}
