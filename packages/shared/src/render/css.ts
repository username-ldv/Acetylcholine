/**
 * Dictionary stylesheet helpers for the renderer: `ace-asset:` references inside `url()` are
 * resolved to object URLs before the CSS is injected.
 */
import { rewriteCssUrls, transformCssRules } from '@acetylcholine/ace';

export const ACE_ASSET_PREFIX = 'ace-asset:';

/** Splits a selector list on the commas that separate selectors (not those inside `:is(a, b)` or strings). */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i]!;
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += list[i + 1] ?? '';
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Confines a stylesheet to the elements under `scope` (a selector): every style selector is
 * prefixed with it, `:host` and `:root` become the scope element itself, `@font-face` rules are
 * dropped (fonts are not exported) and keyframe selectors are left alone. Used for dictionary CSS
 * shipped with Anki notes, where it must not touch the rest of the card.
 */
export function scopeCss(css: string, scope: string): string {
  let keyframesDepth: number | null = null;
  return transformCssRules(css, (rule) => {
    if (keyframesDepth !== null && rule.depth <= keyframesDepth) keyframesDepth = null;
    if (rule.isAtRule) {
      const name = rule.prelude.slice(1).split(/[\s(]/, 1)[0]!.toLowerCase();
      if (name === 'font-face') return null;
      if (name.endsWith('keyframes')) keyframesDepth = rule.depth;
      return rule.prelude;
    }
    if (keyframesDepth !== null) return rule.prelude;
    return splitSelectors(rule.prelude)
      .map((selector) => {
        if (/^:(host|root)\b/.test(selector)) {
          return selector.replace(/^:(host|root)(\([^)]*\))?/, scope);
        }
        return `${scope} ${selector}`;
      })
      .join(', ');
  });
}

export function decodeAssetPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * Replaces every `url(ace-asset:<path>)` with the URL `resolveAsset` returns for it. References
 * that cannot be resolved are left untouched (the browser then simply fails to load them).
 */
export async function resolveCssAssets(
  css: string,
  resolveAsset: (path: string) => Promise<string | null>,
): Promise<string> {
  if (!css.includes(ACE_ASSET_PREFIX)) return css;
  const paths = new Set<string>();
  rewriteCssUrls(css, (url) => {
    if (url.startsWith(ACE_ASSET_PREFIX))
      paths.add(decodeAssetPath(url.slice(ACE_ASSET_PREFIX.length)));
    return null;
  });
  const resolved = new Map<string, string | null>();
  await Promise.all(
    [...paths].map(async (path) => {
      resolved.set(path, await resolveAsset(path).catch(() => null));
    }),
  );
  return rewriteCssUrls(css, (url) => {
    if (!url.startsWith(ACE_ASSET_PREFIX)) return null;
    return resolved.get(decodeAssetPath(url.slice(ACE_ASSET_PREFIX.length))) ?? null;
  });
}
