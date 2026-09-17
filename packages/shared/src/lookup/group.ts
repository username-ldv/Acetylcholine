import type { AceReading } from '@acetylcholine/ace';
import type { LookupGroup, LookupHit } from './types.ts';

/** Reading text as compared across dictionaries: NFC, lower-case, no spaces. */
export function readingKey(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

interface MutableGroup extends LookupGroup {
  headwordSet: Set<string>;
  /** `tag → set of reading keys` */
  readingsByTag: Map<string, Set<string>>;
  untaggedReadings: Set<string>;
  firstDictIndex: number;
}

/**
 * Groups hits into (word, pronunciation) groups. Two entries belong together when they share a
 * headword and their readings agree: if they have a reading system (tag) in common they must
 * share a reading in it; entries whose reading systems are disjoint, or that have no readings,
 * attach to the first compatible group in dictionary order (a Cantonese dictionary's 读 joins the
 * first Mandarin group rather than forming its own, and never merges dú with dòu).
 *
 * Groups are ordered by match length (longest first), then by the best dictionary they contain,
 * then by score. Entries inside a group follow dictionary order.
 */
export function groupHits(
  hits: readonly LookupHit[],
  dictionaryOrder: readonly string[],
): LookupGroup[] {
  const order = new Map<string, number>();
  for (let i = 0; i < dictionaryOrder.length; i++) order.set(dictionaryOrder[i]!, i);
  const rank = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;

  const sorted = [...hits].sort(
    (a, b) =>
      b.length - a.length ||
      rank(a.dictionary) - rank(b.dictionary) ||
      b.entry.score - a.entry.score ||
      a.entry.id - b.entry.id,
  );

  const groups: MutableGroup[] = [];
  for (const hit of sorted) {
    const target = groups.find((g) => g.length === hit.length && compatible(g, hit));
    if (target) {
      addToGroup(target, hit, rank(hit.dictionary));
    } else {
      const g: MutableGroup = {
        matched: hit.matched,
        length: hit.length,
        headwords: [],
        readings: [],
        entries: [],
        score: hit.entry.score,
        headwordSet: new Set(),
        readingsByTag: new Map(),
        untaggedReadings: new Set(),
        firstDictIndex: rank(hit.dictionary),
      };
      addToGroup(g, hit, rank(hit.dictionary));
      groups.push(g);
    }
  }

  groups.sort(
    (a, b) =>
      b.length - a.length ||
      a.firstDictIndex - b.firstDictIndex ||
      b.score - a.score ||
      a.entries[0]!.entry.id - b.entries[0]!.entry.id,
  );
  for (const g of groups) {
    // Show the form the user actually scanned first (讀 when hovering 讀, 读 when hovering 读).
    const i = g.headwords.indexOf(g.matched);
    if (i > 0) g.headwords.splice(0, 0, ...g.headwords.splice(i, 1));
  }
  return groups.map(({ headwordSet, readingsByTag, untaggedReadings, firstDictIndex, ...g }) => g);
}

function compatible(group: MutableGroup, hit: LookupHit): boolean {
  if (!hit.entry.headwords.some((h) => group.headwordSet.has(h))) return false;
  const readings = hit.entry.readings;
  if (readings.length === 0) return true;
  const groupHasReadings = group.readingsByTag.size > 0 || group.untaggedReadings.size > 0;
  if (!groupHasReadings) return true;

  let comparable = false;
  for (const r of readings) {
    const key = readingKey(r.text);
    if (r.tags.length === 0) {
      if (group.untaggedReadings.size > 0) {
        comparable = true;
        if (group.untaggedReadings.has(key)) return true;
      }
      continue;
    }
    for (const tag of r.tags) {
      const set = group.readingsByTag.get(tag);
      if (!set) continue;
      comparable = true;
      if (set.has(key)) return true;
    }
  }
  return !comparable;
}

function addToGroup(group: MutableGroup, hit: LookupHit, dictIndex: number): void {
  for (const h of hit.entry.headwords) {
    if (!group.headwordSet.has(h)) {
      group.headwordSet.add(h);
      group.headwords.push(h);
    }
  }
  for (const r of hit.entry.readings) mergeReading(group, r);
  group.entries.push({ dictionary: hit.dictionary, entry: hit.entry, kinds: hit.kinds });
  group.score = Math.max(group.score, hit.entry.score);
  group.firstDictIndex = Math.min(group.firstDictIndex, dictIndex);
}

function mergeReading(group: MutableGroup, reading: AceReading): void {
  const key = readingKey(reading.text);
  if (reading.tags.length === 0) group.untaggedReadings.add(key);
  for (const tag of reading.tags) {
    let set = group.readingsByTag.get(tag);
    if (!set) {
      set = new Set();
      group.readingsByTag.set(tag, set);
    }
    set.add(key);
  }
  const existing = group.readings.find((r) => readingKey(r.text) === key);
  if (existing) {
    for (const t of reading.tags) if (!existing.tags.includes(t)) existing.tags.push(t);
  } else {
    group.readings.push({ text: reading.text, tags: [...reading.tags] });
  }
}
