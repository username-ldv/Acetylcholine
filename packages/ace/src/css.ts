/**
 * A small CSS rule walker for `styles.css`: enough to rewrite or drop whole rules (including
 * nested rules and rules inside at-rule blocks) and to rewrite `url()` references, while leaving
 * declarations, comments and strings untouched. It is deliberately not a CSS parser.
 */

export interface CssRule {
  /** Selector or at-rule prelude, comments removed and trimmed. */
  prelude: string;
  /** Raw text between the rule's braces. */
  body: string;
  isAtRule: boolean;
  /** 0 for top-level rules. */
  depth: number;
}

/**
 * Returns the prelude to keep (unchanged or rewritten) or `null` to drop the rule together with
 * its body. The bodies of kept rules are visited recursively.
 */
export type CssRuleVisitor = (rule: CssRule) => string | null;

export function transformCssRules(css: string, visit: CssRuleVisitor): string {
  return processBlock(css, 0, css.length, 0, visit);
}

function processBlock(
  css: string,
  start: number,
  end: number,
  depth: number,
  visit: CssRuleVisitor,
): string {
  let out = '';
  let prelude = '';
  let i = start;
  while (i < end) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      const stop = close === -1 || close + 2 > end ? end : close + 2;
      prelude += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = skipString(css, i, end);
      prelude += css.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === ';') {
      out += `${prelude};`;
      prelude = '';
      i++;
      continue;
    }
    if (ch === '{') {
      const close = matchBrace(css, i, end);
      const leading = /^\s*/.exec(prelude)?.[0] ?? '';
      const preludeText = prelude.slice(leading.length);
      const selector = preludeText.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      const body = css.slice(i + 1, close);
      const replacement = visit({
        prelude: selector,
        body,
        isAtRule: selector.startsWith('@'),
        depth,
      });
      if (replacement === null) {
        // drop the whole rule, keep the leading whitespace so formatting stays sane
        out += leading;
      } else {
        const inner = processBlock(css, i + 1, close, depth + 1, visit);
        const head = replacement === selector ? preludeText : `${replacement} `;
        out += `${leading}${head}{${inner}}`;
      }
      prelude = '';
      i = close + 1;
      continue;
    }
    prelude += ch;
    i++;
  }
  return out + prelude;
}

/** Index just past the closing quote of the string starting at `i`. */
function skipString(css: string, i: number, end: number): number {
  const quote = css[i];
  let j = i + 1;
  while (j < end) {
    const c = css[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === quote) return j + 1;
    if (c === '\n') return j;
    j++;
  }
  return end;
}

/** Index of the `}` matching the `{` at `open`, or `end` when unbalanced. */
function matchBrace(css: string, open: number, end: number): number {
  let depth = 0;
  let i = open;
  while (i < end) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close === -1 ? end : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(css, i, end);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return end;
}

const URL_RE = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)"'\s]*))\s*\)/g;

/**
 * Rewrites every `url()` reference. The callback receives the unquoted URL and returns the new
 * URL, or `null` to keep the reference as it is.
 */
export function rewriteCssUrls(css: string, rewrite: (url: string) => string | null): string {
  if (!css.includes('url(')) return css;
  return css.replace(URL_RE, (match, dq?: string, sq?: string, bare?: string) => {
    const url = (dq ?? sq ?? bare ?? '').trim();
    const next = rewrite(url);
    if (next === null || next === url) return match;
    return `url("${next.replace(/["\\]/g, '\\$&')}")`;
  });
}

/** Every `url()` reference in the stylesheet, in order, unquoted. */
export function cssUrls(css: string): string[] {
  const out: string[] = [];
  rewriteCssUrls(css, (url) => {
    out.push(url);
    return null;
  });
  return out;
}

/**
 * Splits `@font-face` rules from the rest of a stylesheet. Fonts declared inside a shadow root are
 * not reliably available to the shadow tree, so the popup moves them to the document.
 */
export function extractFontFaces(css: string): { fontFaces: string; rest: string } {
  if (!/@font-face\b/i.test(css)) return { fontFaces: '', rest: css };
  const faces: string[] = [];
  const rest = transformCssRules(css, (rule) => {
    if (rule.isAtRule && /^@font-face\b/i.test(rule.prelude)) {
      faces.push(`@font-face {${rule.body}}`);
      return null;
    }
    return rule.prelude;
  });
  return { fontFaces: faces.join('\n'), rest };
}
