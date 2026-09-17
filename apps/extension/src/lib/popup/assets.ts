import { AssetUrlCache } from '../db/assets.ts';

let cache: AssetUrlCache | null = null;

/** Page-wide asset URL cache (object URLs live until the page unloads). */
export function assetCache(): AssetUrlCache {
  if (!cache) cache = new AssetUrlCache();
  return cache;
}

export function resolveAsset(dictionaryNumber: number, path: string): Promise<string | null> {
  return assetCache().url(dictionaryNumber, path);
}
