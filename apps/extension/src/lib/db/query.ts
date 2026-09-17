import type { AceKeyKind } from '@acetylcholine/ace';
import type { ScanCandidate } from '@acetylcholine/shared';
import { type AceDatabase, type EntryRecord, getDatabase } from './schema.ts';

export interface CandidateMatch {
  candidate: ScanCandidate;
  entry: EntryRecord;
  kinds: AceKeyKind[];
}

/**
 * Finds entries for every candidate string in one read-only transaction: a `getAll` on the `key`
 * index per candidate, filtered to the given dictionary numbers, then one `get` per distinct
 * entry. Results keep candidate order (longest first when the adapter orders them so).
 */
export async function queryCandidates(
  candidates: readonly ScanCandidate[],
  dictionaryNumbers: ReadonlySet<number>,
  db?: AceDatabase,
): Promise<CandidateMatch[]> {
  if (candidates.length === 0 || dictionaryNumbers.size === 0) return [];
  const database = db ?? (await getDatabase());
  const tx = database.transaction(['keys', 'entries'], 'readonly');
  const keyIndex = tx.objectStore('keys').index('key');
  const entryStore = tx.objectStore('entries');

  const keyRows = await Promise.all(candidates.map((c) => keyIndex.getAll(c.text)));

  // Distinct (dictionary, entry) per candidate, with the key kinds that matched.
  const perCandidate: {
    candidate: ScanCandidate;
    refs: Map<string, { d: number; id: number; kinds: AceKeyKind[] }>;
  }[] = [];
  const toFetch = new Map<string, { d: number; id: number }>();
  for (let i = 0; i < candidates.length; i++) {
    const refs = new Map<string, { d: number; id: number; kinds: AceKeyKind[] }>();
    for (const row of keyRows[i]!) {
      if (!dictionaryNumbers.has(row.d)) continue;
      const key = `${row.d}:${row.entry}`;
      let ref = refs.get(key);
      if (!ref) {
        ref = { d: row.d, id: row.entry, kinds: [] };
        refs.set(key, ref);
        toFetch.set(key, ref);
      }
      if (!ref.kinds.includes(row.kind)) ref.kinds.push(row.kind);
    }
    perCandidate.push({ candidate: candidates[i]!, refs });
  }

  const fetched = new Map<string, EntryRecord | undefined>();
  await Promise.all(
    [...toFetch.entries()].map(async ([key, ref]) => {
      fetched.set(key, await entryStore.get([ref.d, ref.id]));
    }),
  );
  await tx.done;

  const out: CandidateMatch[] = [];
  for (const { candidate, refs } of perCandidate) {
    for (const [key, ref] of refs) {
      const entry = fetched.get(key);
      if (entry) out.push({ candidate, entry, kinds: ref.kinds });
    }
  }
  return out;
}

/** Frequency / pitch / IPA meta rows for exact terms in the given dictionaries. */
export async function queryMeta(
  terms: readonly string[],
  dictionaryNumbers: ReadonlySet<number>,
  db?: AceDatabase,
): Promise<{ d: number; term: string; kind: string; data: unknown }[]> {
  if (terms.length === 0 || dictionaryNumbers.size === 0) return [];
  const database = db ?? (await getDatabase());
  const tx = database.transaction('meta', 'readonly');
  const index = tx.objectStore('meta').index('term');
  const rows = await Promise.all(terms.map((t) => index.getAll(t)));
  await tx.done;
  const out: { d: number; term: string; kind: string; data: unknown }[] = [];
  for (const list of rows) {
    for (const row of list) {
      if (dictionaryNumbers.has(row.d)) out.push(row);
    }
  }
  return out;
}
