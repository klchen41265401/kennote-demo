/**
 * LaTeX 子集 → MathML（不安裝 KaTeX）。
 *
 * 決策：KaTeX / MathJax 都是 runtime 套件，本專案禁止引入。
 * 這裡自己寫一個**很小的**子集轉換器，涵蓋日常筆記 90% 的公式：
 *   上下標 `x^2` `a_i`、分數 `\frac{a}{b}`、根號 `\sqrt{x}`、
 *   希臘字母 `\alpha`、常見運算子 `\times \le \sum \int` …
 * 看不懂的語法一律回傳 null，呼叫端退回「原樣顯示 $...$」，
 * 絕不猜測、絕不吞掉使用者的內容（已知限制寫在 README）。
 *
 * 產出是**我們自己組出來的字串**（所有文字都經過 escape），
 * 沒有任何外部 HTML 進入 DOM。
 */

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kapp: 'κ', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};

const OPERATORS: Record<string, string> = {
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '⋅', ast: '∗',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡',
  sum: '∑', prod: '∏', int: '∫', oint: '∮', infty: '∞', partial: '∂', nabla: '∇',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩',
  forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒',
  sqrt: '√', angle: '∠', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
  ldots: '…', cdots: '⋯', deg: '°',
};

const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'mod',
]);

interface Token {
  kind: 'cmd' | 'lbrace' | 'rbrace' | 'sup' | 'sub' | 'num' | 'ident' | 'op' | 'space';
  value: string;
}

function lex(src: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      out.push({ kind: 'space', value: ' ' });
      i += 1;
    } else if (ch === '\\') {
      const m = /^\\([a-zA-Z]+|[{}%$&#_ ])/.exec(src.slice(i));
      if (!m) return null;
      out.push({ kind: 'cmd', value: m[1] as string });
      i += m[0].length;
    } else if (ch === '{') {
      out.push({ kind: 'lbrace', value: ch });
      i += 1;
    } else if (ch === '}') {
      out.push({ kind: 'rbrace', value: ch });
      i += 1;
    } else if (ch === '^') {
      out.push({ kind: 'sup', value: ch });
      i += 1;
    } else if (ch === '_') {
      out.push({ kind: 'sub', value: ch });
      i += 1;
    } else if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+(?:\.[0-9]+)?/.exec(src.slice(i));
      out.push({ kind: 'num', value: m?.[0] ?? ch });
      i += m?.[0].length ?? 1;
    } else if (/[a-zA-Z]/.test(ch)) {
      out.push({ kind: 'ident', value: ch });
      i += 1;
    } else if ('+-*/=<>(),.|[]!:;'.includes(ch)) {
      out.push({ kind: 'op', value: ch });
      i += 1;
    } else {
      return null; // 不認得的字元 → 放棄，退回純文字
    }
  }
  return out;
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  /** 一連串 atom（含上下標），包成 mrow */
  parseRow(stopAtBrace: boolean): string | null {
    const parts: string[] = [];
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === 'rbrace') {
        if (stopAtBrace) break;
        return null;
      }
      const atom = this.parseScripted();
      if (atom === null) return null;
      parts.push(atom);
    }
    if (parts.length === 0) return '<mrow></mrow>';
    return parts.length === 1 ? (parts[0] as string) : `<mrow>${parts.join('')}</mrow>`;
  }

  private parseScripted(): string | null {
    let base = this.parseAtom();
    if (base === null) return null;
    for (;;) {
      const t = this.peek();
      if (!t || (t.kind !== 'sup' && t.kind !== 'sub')) break;
      this.next();
      const script = this.parseAtom();
      if (script === null) return null;
      base = t.kind === 'sup' ? `<msup>${base}${script}</msup>` : `<msub>${base}${script}</msub>`;
    }
    return base;
  }

  private parseGroup(): string | null {
    const t = this.peek();
    if (!t) return null;
    if (t.kind === 'lbrace') {
      this.next();
      const inner = this.parseRow(true);
      if (inner === null) return null;
      if (this.peek()?.kind !== 'rbrace') return null;
      this.next();
      return inner;
    }
    return this.parseAtom();
  }

  private parseAtom(): string | null {
    const t = this.next();
    if (!t) return null;
    switch (t.kind) {
      case 'space':
        return '';
      case 'num':
        return `<mn>${esc(t.value)}</mn>`;
      case 'ident':
        return `<mi>${esc(t.value)}</mi>`;
      case 'op':
        return `<mo>${esc(t.value)}</mo>`;
      case 'lbrace': {
        this.pos -= 1;
        return this.parseGroup();
      }
      case 'cmd': {
        const name = t.value;
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
          const a = this.parseGroup();
          const b = this.parseGroup();
          if (a === null || b === null) return null;
          return `<mfrac>${a}${b}</mfrac>`;
        }
        if (name === 'sqrt') {
          const a = this.parseGroup();
          if (a === null) return null;
          return `<msqrt>${a}</msqrt>`;
        }
        if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
          const a = this.parseGroup();
          if (a === null) return null;
          return `<mrow>${a}</mrow>`;
        }
        if (name === 'left' || name === 'right') {
          const a = this.parseAtom();
          return a ?? '';
        }
        if (GREEK[name]) return `<mi>${esc(GREEK[name] as string)}</mi>`;
        if (OPERATORS[name]) return `<mo>${esc(OPERATORS[name] as string)}</mo>`;
        if (FUNCTIONS.has(name)) return `<mi>${esc(name)}</mi>`;
        if (name === ' ' || name === ',') return '<mspace width="0.2em"></mspace>';
        return null;
      }
      default:
        return null;
    }
  }

  get done(): boolean {
    return this.pos >= this.tokens.length;
  }
}

/**
 * 轉換成 `<math>` 字串。不支援的語法回傳 null。
 * `display` 為 true 時用 block 模式（獨立區塊的公式）。
 */
export function latexToMathML(source: string, display = false): string | null {
  const src = source.trim().replace(/^\$+|\$+$/g, '').trim();
  if (!src) return null;
  const tokens = lex(src);
  if (!tokens) return null;
  const parser = new Parser(tokens);
  const body = parser.parseRow(false);
  if (body === null || !parser.done) return null;
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${body}</math>`;
}

/** 瀏覽器是否認得 MathML（Chrome 109+ / Firefox / Safari 都可以） */
export function supportsMathML(): boolean {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('div');
  probe.innerHTML = '<math><mi>x</mi></math>';
  const el = probe.firstElementChild;
  return !!el && el.namespaceURI === 'http://www.w3.org/1998/Math/MathML';
}
