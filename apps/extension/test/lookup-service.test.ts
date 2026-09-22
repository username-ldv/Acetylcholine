import { AceKeyKind, AceWriter } from '@acetylcholine/ace';
import { defaultSettings, type Settings } from '@acetylcholine/shared';
import { configure } from '@zip.js/zip.js';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AceDatabase, DB_NAME, importAce, openDatabase } from '../src/lib/db/index.ts';
import { LookupService } from '../src/lib/lookup-service.ts';

configure({ useWebWorkers: false });

interface Row {
  headwords: string[];
  reading: string;
  /** Lookup keys; every headword when omitted. */
  keys?: string[];
}

async function makeAce(id: string, title: string, rows: Row[]): Promise<Blob> {
  const writer = new AceWriter();
  for (const row of rows) {
    const n = await writer.addEntry({
      headwords: row.headwords,
      readings: [{ text: row.reading, tags: ['pinyin'] }],
      content: [{ type: 'text', text: `${title}: ${row.headwords.join('/')} ${row.reading}` }],
      tags: [],
      termTags: [],
      rules: [],
      score: 0,
      sequence: -1,
    });
    const keys = row.keys ?? row.headwords;
    for (const k of keys) {
      await writer.addKey(k, n, k === row.headwords[0] ? AceKeyKind.Headword : AceKeyKind.Variant);
    }
  }
  const { blob } = await writer.finish({ id, title, revision: '1', source: { format: 'yomitan' } });
  return blob!;
}

/** Traditional dictionary: keys both scripts, as the MOE exports do. */
const moeRows: Row[] = [
  { headwords: ['圖片', '图片'], reading: 'tú piàn' },
  { headwords: ['理髮', '理发'], reading: 'lǐ fǎ' },
  { headwords: ['理'], reading: 'lǐ' },
  { headwords: ['髮', '发'], reading: 'fǎ' },
  { headwords: ['發', '发'], reading: 'fā' },
  { headwords: ['乾', '干'], reading: 'gān' },
  { headwords: ['幹', '干'], reading: 'gàn' },
];

/** Simplified dictionary: compounds keyed in simplified only; single characters name their traditional form. */
const hanyuRows: Row[] = [
  { headwords: ['图片'], reading: 'túpiàn' },
  { headwords: ['理发'], reading: 'lǐ fà' },
  { headwords: ['理'], reading: 'lǐ' },
  { headwords: ['发', '發'], reading: 'fā' },
  { headwords: ['发', '髮'], reading: 'fà' },
  /** Lists 乾 as a form but is only keyed by 干: reached through the variant and confirmed by 乾. */
  { headwords: ['干', '乾', '乹'], reading: 'gān', keys: ['干'] },
  { headwords: ['干'], reading: 'gàn' },
];

describe('LookupService variant expansion', () => {
  let db: AceDatabase;
  let settings: Settings;
  let service: LookupService;

  beforeEach(async () => {
    db = await openDatabase();
    await importAce(await makeAce('test:hanyu', '现汉', hanyuRows), { db });
    await importAce(await makeAce('test:moe', 'MOE', moeRows), { db });
    settings = defaultSettings();
    service = new LookupService(() => Promise.resolve(settings));
  });

  afterEach(async () => {
    db.close();
    await deleteDB(DB_NAME);
  });

  it('reaches the simplified-only dictionary through the form the traditional one lists', async () => {
    const result = await service.lookup('圖片');
    expect(result.matchLength).toBe(2);
    expect(result.groups).toHaveLength(1);
    const [group] = result.groups;
    expect(group!.headwords).toEqual(['圖片', '图片']);
    expect(group!.entries.map((e) => [e.dictionary, e.via ?? null])).toEqual([
      ['test:hanyu', { form: '图片', ambiguous: false }],
      ['test:moe', null],
    ]);
    expect(result.dictionaries.map((d) => d.id)).toEqual(['test:hanyu', 'test:moe']);
  });

  it('puts a via-only pronunciation after the direct one and keeps shorter candidates apart', async () => {
    const result = await service.lookup('理髮師');
    expect(result.groups.map((g) => [g.matched, g.headwords[0], g.readings[0]!.text])).toEqual([
      ['理髮', '理髮', 'lǐ fǎ'],
      ['理髮', '理发', 'lǐ fà'],
      ['理', '理', 'lǐ'],
    ]);
    expect(result.groups[1]!.entries[0]!.via).toEqual({ form: '理发', ambiguous: false });
    // 理 is keyed directly in both dictionaries: nothing to expand, no marks.
    expect(result.groups[2]!.entries.every((e) => e.via === undefined)).toBe(true);
  });

  it('never shows the other word sharing a simplified form (髮 does not bring 發)', async () => {
    const result = await service.lookup('髮');
    const ids = result.groups.flatMap((g) =>
      g.entries.map((e) => `${e.dictionary}:${e.entry.readings[0]!.text}`),
    );
    expect(ids).toEqual(['test:hanyu:fà', 'test:moe:fǎ']);
    expect(result.groups.flatMap((g) => g.entries).every((e) => e.via === undefined)).toBe(true);
  });

  it('marks a contested form ambiguous unless the entry itself names the scanned form', async () => {
    const result = await service.lookup('乾');
    const entries = result.groups.flatMap((g) => g.entries);
    expect(entries.map((e) => [e.entry.headwords.join('|'), e.via ?? null])).toEqual([
      ['干|乾|乹', { form: '干', ambiguous: false }],
      ['乾|干', null],
      ['干', { form: '干', ambiguous: true }],
    ]);
  });

  it('does nothing when the setting is off', async () => {
    settings.profiles[0]!.lookup.variants = false;
    service.invalidateResults();
    const result = await service.lookup('圖片');
    expect(result.groups[0]!.entries.map((e) => e.dictionary)).toEqual(['test:moe']);
  });
});
