/** 詞法分析：字串 → Token[]。不做任何語意判斷。 */
import { FormulaError, type Token } from './ast.js';

const THREE_CHAR: string[] = [];
const TWO_CHAR = ['==', '!=', '<>', '>=', '<=', '&&', '||'];
const ONE_CHAR = ['+', '-', '*', '/', '%', '^', '>', '<', '!', '='];

function isDigit(c: string): boolean {
  return c >= '0' && c <= '9';
}

/** 識別字允許中文（使用者常把 prop 名稱寫成中文；prop("…") 才是正式寫法，但函式名一律 ASCII） */
function isIdentStart(c: string): boolean {
  return /[A-Za-z_\u4e00-\u9fff]/.test(c);
}
function isIdentPart(c: string): boolean {
  return /[A-Za-z0-9_\u4e00-\u9fff]/.test(c);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i] as string;

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i += 1;
      continue;
    }

    if (c === '(') {
      tokens.push({ kind: 'lparen', value: '(', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === ')') {
      tokens.push({ kind: 'rparen', value: ')', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === ',') {
      tokens.push({ kind: 'comma', value: ',', start: i, end: i + 1 });
      i += 1;
      continue;
    }

    // 字串字面值：支援 " 與 '，跳脫用 \
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      let out = '';
      let closed = false;
      while (i < input.length) {
        const ch = input[i] as string;
        if (ch === String.fromCharCode(92) && i + 1 < input.length) {
          const next = input[i + 1] as string;
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (ch === quote) {
          closed = true;
          i += 1;
          break;
        }
        out += ch;
        i += 1;
      }
      if (!closed) throw new FormulaError('SYNTAX', '字串沒有結束的引號', start);
      tokens.push({ kind: 'string', value: out, start, end: i });
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
      const start = i;
      while (i < input.length && isDigit(input[i] as string)) i += 1;
      if (input[i] === '.') {
        i += 1;
        while (i < input.length && isDigit(input[i] as string)) i += 1;
      }
      if (input[i] === 'e' || input[i] === 'E') {
        const save = i;
        i += 1;
        if (input[i] === '+' || input[i] === '-') i += 1;
        if (isDigit(input[i] ?? '')) {
          while (i < input.length && isDigit(input[i] as string)) i += 1;
        } else {
          i = save;
        }
      }
      tokens.push({ kind: 'number', value: input.slice(start, i), start, end: i });
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < input.length && isIdentPart(input[i] as string)) i += 1;
      const word = input.slice(start, i);
      const lower = word.toLowerCase();
      if (lower === 'and' || lower === 'or' || lower === 'not') {
        tokens.push({ kind: 'operator', value: lower, start, end: i });
      } else {
        tokens.push({ kind: 'ident', value: word, start, end: i });
      }
      continue;
    }

    const three = input.slice(i, i + 3);
    if (THREE_CHAR.includes(three)) {
      tokens.push({ kind: 'operator', value: three, start: i, end: i + 3 });
      i += 3;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (TWO_CHAR.includes(two)) {
      const normalized = two === '<>' ? '!=' : two === '&&' ? 'and' : two === '||' ? 'or' : two;
      tokens.push({ kind: 'operator', value: normalized, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (ONE_CHAR.includes(c)) {
      // 單一個 = 視為 ==（使用者常這樣寫），單一個 ! 視為 not
      const normalized = c === '=' ? '==' : c === '!' ? 'not' : c;
      tokens.push({ kind: 'operator', value: normalized, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    throw new FormulaError('SYNTAX', `看不懂的符號「${c}」`, i);
  }

  tokens.push({ kind: 'eof', value: '', start: input.length, end: input.length });
  return tokens;
}
