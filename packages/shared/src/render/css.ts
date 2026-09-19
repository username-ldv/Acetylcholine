/**
 * Dictionary stylesheet helpers for the renderer: `ace-asset:` references inside `url()` are
 * resolved to object URLs before the CSS is injected.
 */
import { rewriteCssUrls } from '@acetylcholine/ace';

export const ACE_ASSET_PREFIX = 'ace-asset:';

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
