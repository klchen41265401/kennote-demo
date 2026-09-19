/**
 * 自研輕量語法高亮（01 §4.4 M3.4.9 / 02 §8.5）。
 *
 * 紀律：**不引入 Prism / highlight.js / Shiki**。
 * 這裡只做「詞法層」——把原始碼切成 token 陣列，不做語意分析、不建 AST。
 * 對閱讀程式碼片段而言，詞法層已經涵蓋 95% 的視覺價值。
 *
 * 實作方式：每個語言一組「有序的 sticky regex 規則」，從位置 0 開始依序嘗試，
 * 第一個命中的規則吃掉那段文字。沒有任何規則命中就前進一個字元當 plain。
 * 純函式、零依賴，可在 Node 直接單測。
 */

export type TokenType =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'function'
  | 'operator'
  | 'punctuation'
  | 'tag'
  | 'attribute'
  | 'property'
  | 'heading'
  | 'link';

export interface Token {
  text: string;
  type: TokenType;
}

interface Rule {
  type: TokenType;
  re: RegExp;
}

/** slash menu / 語言選單用的清單（30 種 + 純文字） */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: 'plain', label: '純文字' },
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'docker', label: 'Dockerfile' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'html', label: 'HTML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'latex', label: 'LaTeX' },
  { id: 'lua', label: 'Lua' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'php', label: 'PHP' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'python', label: 'Python' },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'scss', label: 'SCSS' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'toml', label: 'TOML' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
];

/** 常見別名 → 正式 id */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  'c++': 'cpp',
  cs: 'csharp',
  dockerfile: 'docker',
  ps1: 'powershell',
  htm: 'html',
  text: 'plain',
  txt: 'plain',
  '': 'plain',
};

export function normalizeLanguage(language: string | undefined | null): string {
  const raw = (language ?? 'plain').toLowerCase().trim();
  const id = ALIASES[raw] ?? raw;
  return CODE_LANGUAGES.some((l) => l.id === id) ? id : 'plain';
}

export function languageLabel(language: string | undefined | null): string {
  const id = normalizeLanguage(language);
  return CODE_LANGUAGES.find((l) => l.id === id)?.label ?? '純文字';
}

// ── 共用片段 ────────────────────────────────────────────────
const NUMBER = /0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?/y;
const WS = /\s+/y;

function kw(words: string): RegExp {
  return new RegExp(`\\b(?:${words})\\b`, 'y');
}

const JS_KEYWORDS =
  'abstract|any|as|asserts|async|await|boolean|break|case|catch|class|const|constructor|continue|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|namespace|never|new|null|number|of|private|protected|public|readonly|return|satisfies|set|static|string|super|switch|symbol|this|throw|true|try|type|typeof|undefined|unique|unknown|var|void|while|with|yield';
const JS_BUILTINS =
  'Array|Boolean|console|Date|document|Error|globalThis|JSON|Map|Math|Number|Object|Promise|Proxy|Reflect|RegExp|Set|String|Symbol|window|WeakMap|WeakSet|require|module|process';

const JS_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /\/\/[^\n]*/y },
  { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y },
  { type: 'string', re: /`(?:\\[\s\S]|[^`\\])*`?/y },
  { type: 'string', re: /"(?:\\[\s\S]|[^"\\\n])*"?/y },
  { type: 'string', re: /'(?:\\[\s\S]|[^'\\\n])*'?/y },
  { type: 'number', re: NUMBER },
  { type: 'keyword', re: kw(JS_KEYWORDS) },
  { type: 'builtin', re: kw(JS_BUILTINS) },
  { type: 'function', re: /[A-Za-z_$][\w$]*(?=\s*\()/y },
  { type: 'property', re: /(?<=\.)[A-Za-z_$][\w$]*/y },
  { type: 'operator', re: /=>|\.\.\.|[+\-*/%=<>!&|^~?:]+/y },
  { type: 'punctuation', re: /[{}[\]();,.]/y },
];

const PY_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /#[^\n]*/y },
  { type: 'string', re: /[rRbBfFuU]{0,2}("""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/y },
  { type: 'string', re: /[rRbBfFuU]{0,2}"(?:\\[\s\S]|[^"\\\n])*"?/y },
  { type: 'string', re: /[rRbBfFuU]{0,2}'(?:\\[\s\S]|[^'\\\n])*'?/y },
  { type: 'number', re: NUMBER },
  {
    type: 'keyword',
    re: kw(
      'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|match|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None',
    ),
  },
  {
    type: 'builtin',
    re: kw(
      'abs|all|any|bool|bytes|dict|dir|enumerate|filter|float|format|frozenset|getattr|hasattr|int|isinstance|len|list|map|max|min|next|open|print|range|repr|reversed|round|set|setattr|sorted|str|sum|super|tuple|type|zip|self',
    ),
  },
  { type: 'function', re: /[A-Za-z_]\w*(?=\s*\()/y },
  { type: 'operator', re: /[+\-*/%=<>!&|^~@]+/y },
  { type: 'punctuation', re: /[{}[\]();,.:]/y },
];

const JSON_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'property', re: /"(?:\\.|[^"\\])*"(?=\s*:)/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"?/y },
  { type: 'number', re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y },
  { type: 'keyword', re: kw('true|false|null') },
  { type: 'punctuation', re: /[{}[\],:]/y },
];

const SQL_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /--[^\n]*/y },
  { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y },
  { type: 'string', re: /'(?:''|[^'])*'?/y },
  { type: 'string', re: /"(?:""|[^"])*"?/y },
  { type: 'number', re: NUMBER },
  {
    type: 'keyword',
    re: new RegExp(
      '\\b(?:ADD|ALL|ALTER|AND|AS|ASC|BEGIN|BETWEEN|BY|CASCADE|CASE|CHECK|COMMIT|CONSTRAINT|CREATE|CROSS|DEFAULT|DELETE|DESC|DISTINCT|DROP|ELSE|END|EXISTS|FALSE|FOREIGN|FROM|FULL|GROUP|HAVING|IF|IN|INDEX|INNER|INSERT|INTO|IS|JOIN|KEY|LEFT|LIKE|LIMIT|NOT|NULL|OFFSET|ON|OR|ORDER|OUTER|PRIMARY|REFERENCES|RETURNING|RIGHT|ROLLBACK|SELECT|SET|TABLE|THEN|TRUE|UNION|UNIQUE|UPDATE|VALUES|VIEW|WHEN|WHERE|WITH)\\b',
      'yi',
    ),
  },
  {
    type: 'builtin',
    re: new RegExp(
      '\\b(?:AVG|BIGINT|BOOLEAN|CHAR|COALESCE|COUNT|DATE|DECIMAL|FLOAT|INT|INTEGER|JSON|JSONB|MAX|MIN|NOW|NUMERIC|SERIAL|SUM|TEXT|TIMESTAMP|UUID|VARCHAR)\\b',
      'yi',
    ),
  },
  { type: 'operator', re: /[+\-*/%=<>!|]+/y },
  { type: 'punctuation', re: /[();,.]/y },
];

const BASH_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /#[^\n]*/y },
  { type: 'string', re: /"(?:\\[\s\S]|[^"\\])*"?/y },
  { type: 'string', re: /'(?:[^'])*'?/y },
  { type: 'builtin', re: /\$\{[^}]*\}|\$[A-Za-z_]\w*|\$[\d@*#?$!]/y },
  {
    type: 'keyword',
    re: kw(
      'case|do|done|elif|else|esac|fi|for|function|if|in|local|return|select|then|until|while|export|source|alias|set|unset',
    ),
  },
  {
    type: 'builtin',
    re: kw(
      'awk|cat|cd|chmod|cp|curl|cut|date|df|diff|du|echo|find|grep|head|kill|ls|mkdir|mv|npm|pnpm|printf|ps|pwd|read|rm|sed|sort|ssh|sudo|tail|tar|test|touch|uniq|wc|wget|xargs|git|docker|node',
    ),
  },
  { type: 'number', re: NUMBER },
  { type: 'operator', re: /&&|\|\||[|&><]=?|[-+*/%=!]+/y },
  { type: 'punctuation', re: /[{}[\]();,]/y },
];

const CSS_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y },
  { type: 'string', re: /"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/y },
  { type: 'keyword', re: /@[\w-]+/y },
  { type: 'builtin', re: /--[\w-]+/y },
  { type: 'property', re: /[-a-zA-Z]+(?=\s*:)/y },
  { type: 'number', re: /[-+]?\d*\.?\d+(?:%|[a-z]{1,4})?/y },
  { type: 'function', re: /[\w-]+(?=\()/y },
  { type: 'tag', re: /[.#][\w-]+|&|::?[\w-]+/y },
  { type: 'punctuation', re: /[{}();:,]/y },
];

const MARKUP_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /<!--[\s\S]*?(?:-->|$)/y },
  { type: 'keyword', re: /<!DOCTYPE[^>]*>/iy },
  { type: 'tag', re: /<\/?[A-Za-z][\w:-]*/y },
  { type: 'string', re: /"(?:[^"])*"?|'(?:[^'])*'?/y },
  { type: 'attribute', re: /[A-Za-z_:@#][\w:.-]*(?=\s*=)/y },
  { type: 'operator', re: /[=/]/y },
  { type: 'punctuation', re: />/y },
];

const MD_RULES: Rule[] = [
  { type: 'heading', re: /^#{1,6}[^\n]*/my },
  { type: 'comment', re: /^\s*>[^\n]*/my },
  { type: 'string', re: /```[\s\S]*?(?:```|$)/y },
  { type: 'string', re: /`[^`\n]*`?/y },
  { type: 'keyword', re: /\*\*[^*\n]+\*\*|__[^_\n]+__/y },
  { type: 'builtin', re: /\*[^*\n]+\*|_[^_\n]+_/y },
  { type: 'link', re: /\[[^\]\n]*\]\([^)\n]*\)/y },
  { type: 'operator', re: /^\s*(?:[-*+]|\d+\.)\s/my },
  { type: 'punctuation', re: /^(?:---|\*\*\*|___)$/my },
  { type: 'plain', re: /[^\n`*_[\]#>-]+/y },
];

const YAML_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /#[^\n]*/y },
  { type: 'property', re: /^[ \t]*[\w.-]+(?=\s*:)/my },
  { type: 'string', re: /"(?:\\.|[^"\\])*"?|'(?:''|[^'])*'?/y },
  { type: 'number', re: NUMBER },
  { type: 'keyword', re: kw('true|false|null|yes|no|on|off') },
  { type: 'operator', re: /^[ \t]*-\s/my },
  { type: 'punctuation', re: /[:{}[\],]/y },
];

const DIFF_RULES: Rule[] = [
  { type: 'builtin', re: /^\+[^\n]*/my },
  { type: 'comment', re: /^-[^\n]*/my },
  { type: 'keyword', re: /^@@[^\n]*/my },
  { type: 'plain', re: /[^\n]*\n?/y },
];

/** 泛用規則：至少把字串、註解、數字挑出來，比整片灰字好讀得多 */
const GENERIC_RULES: Rule[] = [
  { type: 'plain', re: WS },
  { type: 'comment', re: /\/\/[^\n]*|#[^\n]*|--[^\n]*/y },
  { type: 'comment', re: /\/\*[\s\S]*?(?:\*\/|$)/y },
  { type: 'string', re: /"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?/y },
  { type: 'number', re: NUMBER },
  {
    type: 'keyword',
    re: kw(
      'abstract|and|as|break|case|catch|class|const|continue|def|default|do|elif|else|end|enum|extends|false|final|finally|for|func|fun|function|if|import|in|interface|let|match|module|mut|new|nil|not|null|or|package|private|protected|public|return|self|static|struct|switch|then|this|throw|trait|true|try|type|use|val|var|void|when|where|while|with',
    ),
  },
  { type: 'function', re: /[A-Za-z_]\w*(?=\s*\()/y },
  { type: 'operator', re: /[+\-*/%=<>!&|^~?:]+/y },
  { type: 'punctuation', re: /[{}[\]();,.]/y },
];

const RULES: Record<string, Rule[]> = {
  javascript: JS_RULES,
  typescript: JS_RULES,
  python: PY_RULES,
  json: JSON_RULES,
  sql: SQL_RULES,
  bash: BASH_RULES,
  css: CSS_RULES,
  scss: CSS_RULES,
  html: MARKUP_RULES,
  xml: MARKUP_RULES,
  markdown: MD_RULES,
  yaml: YAML_RULES,
  toml: YAML_RULES,
  diff: DIFF_RULES,
};

/** 有專屬規則的語言（README 承諾的最小集合） */
export const HIGHLIGHTED_LANGUAGES = Object.keys(RULES);

/**
 * 把原始碼切成 token。相鄰的同型別 token 會被合併，減少 DOM 節點數。
 * `plain` 語言直接回傳單一 token（不做任何比對，長檔案零成本）。
 */
export function tokenize(code: string, language: string | undefined | null): Token[] {
  const id = normalizeLanguage(language);
  if (id === 'plain') return code ? [{ text: code, type: 'plain' }] : [];
  const rules = RULES[id] ?? GENERIC_RULES;

  const out: Token[] = [];
  let pos = 0;
  const push = (text: string, type: TokenType): void => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ text, type });
  };

  // 保險絲：語法極端時不讓迴圈失控（例如 1MB 的單行 minified JS）
  let guard = 0;
  const limit = code.length * 4 + 1000;

  while (pos < code.length) {
    if (++guard > limit) {
      push(code.slice(pos), 'plain');
      break;
    }
    let matched = false;
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      const m = rule.re.exec(code);
      if (m && m[0].length > 0) {
        push(m[0], rule.type);
        pos += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      push(code[pos] as string, 'plain');
      pos += 1;
    }
  }
  return out;
}

/** 行號欄用：算出總行數 */
export function countLines(code: string): number {
  if (code === '') return 1;
  let n = 1;
  for (const ch of code) if (ch === '\n') n += 1;
  return n;
}
