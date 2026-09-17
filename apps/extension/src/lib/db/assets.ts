import { type AceDatabase, getDatabase } from './schema.ts';

/**
 * Resolves dictionary assets to object URLs. URLs are cached per (dictionary, path) for the
 * lifetime of the cache and revoked together with `revokeAll()`.
 */
export class AssetUrlCache {
  private readonly urls = new Map<string, Promise<string | null>>();

  constructor(private readonly db?: AceDatabase) {}

  url(dictionaryNumber: number, path: string): Promise<string | null> {
    const key = `${dictionaryNumber}|${path}`;
    let p = this.urls.get(key);
    if (!p) {
      p = this.load(dictionaryNumber, path);
      this.urls.set(key, p);
    }
    return p;
  }

  private async load(dictionaryNumber: number, path: string): Promise<string | null> {
    const blob = await getAssetBlob(dictionaryNumber, path, this.db);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }

  async revokeAll(): Promise<void> {
    const pending = [...this.urls.values()];
    this.urls.clear();
    for (const p of pending) {
      const url = await p.catch(() => null);
      if (url) URL.revokeObjectURL(url);
    }
  }
}

export async function getAssetBlob(
  dictionaryNumber: number,
  path: string,
  db?: AceDatabase,
): Promise<Blob | null> {
  const database = db ?? (await getDatabase());
  const normalized = normalizePath(path);
  const rec = await database.get('assets', [dictionaryNumber, normalized]);
  return rec?.blob ?? null;
}

function normalizePath(path: string): string {
  let p = path.normalize('NFC').replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  return p;
}
