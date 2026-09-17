import type { DictionaryInfo } from '@acetylcholine/shared';
import {
  type AceDatabase,
  DATA_STORES,
  type DictionaryRecord,
  dictionaryRange,
  getDatabase,
} from './schema.ts';

/** Installed dictionaries in import order (oldest first). */
export async function listDictionaries(db?: AceDatabase): Promise<DictionaryRecord[]> {
  const database = db ?? (await getDatabase());
  const all = await database.getAll('dictionaries');
  return all.sort((a, b) => a.n - b.n);
}

export async function findDictionary(
  id: string,
  db?: AceDatabase,
): Promise<DictionaryRecord | undefined> {
  const database = db ?? (await getDatabase());
  return database.get('dictionaries', id);
}

/** Removes every data row of dictionary number `n` (one key-range delete per store). */
export async function deleteDictionaryData(n: number, db?: AceDatabase): Promise<void> {
  const database = db ?? (await getDatabase());
  const range = dictionaryRange(n);
  for (const store of DATA_STORES) {
    const tx = database.transaction(store, 'readwrite');
    await tx.objectStore(store).delete(range);
    await tx.done;
  }
}

export async function deleteDictionary(id: string, db?: AceDatabase): Promise<boolean> {
  const database = db ?? (await getDatabase());
  const rec = await database.get('dictionaries', id);
  if (!rec) return false;
  await deleteDictionaryData(rec.n, database);
  await database.delete('dictionaries', id);
  return true;
}

export function toDictionaryInfo(rec: DictionaryRecord): DictionaryInfo {
  const m = rec.manifest;
  return {
    id: rec.id,
    n: rec.n,
    title: m.title,
    revision: m.revision,
    author: m.author,
    description: m.description,
    attribution: m.attribution,
    url: m.url,
    sourceLanguage: m.sourceLanguage,
    targetLanguage: m.targetLanguage,
    readingTags: m.readingTags,
    contentKinds: m.contentKinds,
    counts: m.counts,
    fileSize: rec.fileSize,
    hasStyles: rec.styles !== null && rec.styles.length > 0,
    importedAt: rec.importedAt,
    sourceFormat: m.source.format,
  };
}

export interface StorageEstimate {
  usage: number;
  quota: number;
}

export async function storageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Row counts per data store for one dictionary (slow; for diagnostics). */
export async function countDictionaryRows(
  n: number,
  db?: AceDatabase,
): Promise<Record<(typeof DATA_STORES)[number], number>> {
  const database = db ?? (await getDatabase());
  const range = dictionaryRange(n);
  const out = {} as Record<(typeof DATA_STORES)[number], number>;
  for (const store of DATA_STORES) out[store] = await database.count(store, range);
  return out;
}
