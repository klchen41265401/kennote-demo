/**
 * Formula 運算式的詞彙／語法資料結構（04 §8 M4 交付物 4）。
 *
 * 這一整個資料夾是**零依賴的純 TS**：前端（編輯公式時即時檢查）與
 * 後端（查詢時求值）import 同一份檔案，才不會出現「前端說合法、後端算不出來」。
 */

/** 公式的型別系統。'any' 只在推導不出來時出現（例如 if 的兩個分支型別不同） */
export type FormulaType = 'number' | 'string' | 'boolean' | 'date' | 'any';

export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '^'
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'and'
  | 'or';

export type UnaryOperator = '-' | 'not';

export type FormulaAst =
  | { op: 'lit'; value: string | number | boolean | null }
  | { op: 'prop'; propertyId: string; name?: string }
  | { op: 'unary'; operator: UnaryOperator; arg: FormulaAst }
  | { op: 'binary'; operator: BinaryOperator; left: FormulaAst; right: FormulaAst }
  | { op: 'fn'; name: string; args: FormulaAst[] };

/** 求值結果。null = 空值（Notion 的空儲存格） */
export type FormulaValue = number | string | boolean | Date | null;

export type TokenKind =
  | 'number'
  | 'string'
  | 'ident'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof';

export interface Token {
  kind: TokenKind;
  /** number/string 的字面值；ident/operator 的文字 */
  value: string;
  /** 在原始字串中的位置，錯誤訊息用 */
  start: number;
  end: number;
}

export type FormulaErrorCode =
  | 'SYNTAX'
  | 'UNKNOWN_FUNCTION'
  | 'UNKNOWN_PROPERTY'
  | 'ARITY'
  | 'TYPE'
  | 'CYCLE'
  | 'RUNTIME';

/** 公式的錯誤一律走這個類別，訊息是**面向使用者的繁體中文** */
export class FormulaError extends Error {
  readonly code: FormulaErrorCode;
  readonly position: number;

  constructor(code: FormulaErrorCode, message: string, position = 0) {
    super(message);
    this.name = 'FormulaError';
    this.code = code;
    this.position = position;
  }
}

export function isFormulaError(e: unknown): e is FormulaError {
  return e instanceof FormulaError;
}
