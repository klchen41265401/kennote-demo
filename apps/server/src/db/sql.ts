/**
 * tagged template SQL builder（04 §5.2）。
 * 這不是 ORM，只有兩個目的：**杜絕字串拼接造成的注入**、讓片段可組合。
 *
 * 規則：
 * - 內插的「值」一律變成 $1,$2...，永遠不進 SQL 文字
 * - 內插的「片段」（巢狀 Sql）會展平並重新編號參數
 * - 欄位／資料表名稱必須走 sql.raw()，而 raw 只接受白名單識別字
 *
 * 這個檔案**不 import env、不 import pg**，因此可以在沒有資料庫的環境下單元測試。
 */

export interface Sql {
  readonly text: string;
  readonly values: unknown[];
  /** 品牌標記，用來辨識巢狀片段 */
  readonly __sql: true;
}

export function isSql(v: unknown): v is Sql {
  return typeof v === 'object' && v !== null && (v as Sql).__sql === true;
}

function make(text: string, values: unknown[]): Sql {
  return { text, values, __sql: true };
}

/**
 * 白名單：一個「欄位片段」可以是
 *   table.column  /  column::type  /  column AS alias  /  column DESC NULLS LAST
 * 逗號分隔的多個片段也接受（欄位清單）。除此之外一律拒絕 —— 括號、引號、
 * 空白字元、分號、註解符號都進不來，因此 sql.raw() 無法被用來注入。
 */
const IDENTIFIER_SEGMENT =
  /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?(::[A-Za-z_][A-Za-z0-9_]*(\[\])?)?( AS [A-Za-z_][A-Za-z0-9_]*)?( (ASC|DESC))?( NULLS (FIRST|LAST))?$/;

function isSafeIdentifier(value: string): boolean {
  const segments = value.split(',').map((s) => s.trim());
  return segments.length > 0 && segments.every((s) => s !== '' && IDENTIFIER_SEGMENT.test(s));
}

export class UnsafeIdentifierError extends Error {
  constructor(value: string) {
    super(`sql.raw() 收到不合法的識別字：${JSON.stringify(value)}`);
    this.name = 'UnsafeIdentifierError';
  }
}

interface SqlTag {
  (strings: TemplateStringsArray, ...vals: unknown[]): Sql;
  /** 白名單識別字（欄位名、資料表名、排序方向）。任何不符合的輸入直接丟錯 */
  raw(identifier: string): Sql;
  /** 組合多個片段，如 sql.join(conds, ' AND ') */
  join(parts: Sql[], separator: string): Sql;
  /** 空片段（條件式組裝時當作 no-op） */
  empty: Sql;
  /** 把值陣列展開成 ($1, $2, $3) */
  values(list: unknown[]): Sql;
}

function tag(strings: TemplateStringsArray, ...vals: unknown[]): Sql {
  let text = '';
  const values: unknown[] = [];
  strings.forEach((s, i) => {
    text += s;
    if (i >= vals.length) return;
    const v = vals[i];
    if (isSql(v)) {
      const offset = values.length;
      text += v.text.replace(/\$(\d+)/g, (_m, n: string) => `$${Number(n) + offset}`);
      values.push(...v.values);
    } else {
      values.push(v);
      text += `$${values.length}`;
    }
  });
  return make(text, values);
}

const sqlTag = tag as SqlTag;

sqlTag.raw = (identifier: string): Sql => {
  if (!isSafeIdentifier(identifier)) throw new UnsafeIdentifierError(identifier);
  return make(
    identifier
      .split(',')
      .map((s) => s.trim())
      .join(', '),
    [],
  );
};

sqlTag.join = (parts: Sql[], separator: string): Sql => {
  const kept = parts.filter((p) => p.text.trim() !== '');
  if (kept.length === 0) return make('', []);
  let text = '';
  const values: unknown[] = [];
  kept.forEach((p, i) => {
    if (i > 0) text += separator;
    const offset = values.length;
    text += p.text.replace(/\$(\d+)/g, (_m, n: string) => `$${Number(n) + offset}`);
    values.push(...p.values);
  });
  return make(text, values);
};

sqlTag.empty = make('', []);

sqlTag.values = (list: unknown[]): Sql => {
  if (list.length === 0) return make('(NULL)', []);
  return sqlTag.join(
    list.map((v) => tag`${v}`),
    ', ',
  );
};

export const sql = sqlTag;
