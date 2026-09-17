/**
 * CSS helpers shared by converters.
 */

const READING_TAG_ATTRIBUTE = 'data-sc-reading-tag';

/**
 * Removes every rule whose selector mentions `data-sc-reading-tag`, including nested rules and
 * rules inside at-rule blocks. Yomitan editions of a dictionary use such rules to hide the reading
 * system they do not represent; in `.ace` the renderer decides which reading tag to show, so these
 * rules must not survive conversion. Declarations, comments, and strings are preserved elsewhere.
 */
export function stripReadingTagRules(css: string): string {
  if (!css.includes(READING_TAG_ATTRIBUTE)) return css;
  return processBlock(css, 0, css.length);
}

function processBlock(css: string, start: number, end: number): string {
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
      const body = processBlock(css, i + 1, close);
      const selector = prelude.replace(/\/\*[\s\S]*?\*\//g, '');
      if (selector.includes(READING_TAG_ATTRIBUTE)) {
        // drop the whole rule, keep the leading whitespace so formatting stays sane
        const leading = /^\s*/.exec(prelude)?.[0] ?? '';
        out += leading;
      } else {
        out += `${prelude}{${body}}`;
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
