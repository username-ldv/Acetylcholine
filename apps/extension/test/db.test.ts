import { AceKeyKind, AceWriter } from '@acetylcholine/ace';
import { configure } from '@zip.js/zip.js';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type AceDatabase,
  countDictionaryRows,
  DB_NAME,
  deleteDictionary,
  findDictionary,
  getAssetBlob,
  ImportAbortedError,
  type ImportProgress,
  importAce,
  listDictionaries,
  openDatabase,
  queryCandidates,
  toDictionaryInfo,
} from '../src/lib/db/index.ts';

configure({ useWebWorkers: false });

async function makeAce(id: string, title: string, entries = 3): Promise<Blob> {
  const writer = new AceWriter({ entriesPerChunk: 2, keysPerChunk: 3 });
  const du = await writer.addEntry({
    headwords: ['读', '讀'],
    readings: [
      { text: 'dú', tags: ['pinyin'] },
      { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
    ],
    content: [{ type: 'structured', content: { tag: 'img', path: 'img/a.png' } }],
    tags: [],
    termTags: [],
    rules: [],
    score: 0,
    sequence: 1,
  });
  const dou = await writer.addEntry({
    headwords: ['读', '讀'],
    readings: [{ text: 'dòu', tags: ['pinyin'] }],
    content: [{ type: 'text', text: 'pause' }],
    tags: [],
    termTags: [],
    rules: [],
    score: 0,
    sequence: 2,
  });
  const dushu = await writer.addEntry({
    headwords: ['读书'],
    readings: [{ text: 'dú shū', tags: ['pinyin'] }],
    content: [{ type: 'text', text: 'to study' }],
    tags: [],
    termTags: [],
    rules: [],
    score: 3,
    sequence: 3,
  });
  for (let i = 3; i < entries; i++) {
    await writer.addEntry({
      headwords: [`w${i}`],
      readings: [],
      content: [{ type: 'text', text: `${i}` }],
      tags: [],
      termTags: [],
      rules: [],
      score: 0,
      sequence: -1,
    });
    await writer.addKey(`w${i}`, i, AceKeyKind.Headword);
  }
  await writer.addKey('读', du, AceKeyKind.Headword);
  await writer.addKey('讀', du, AceKeyKind.Variant);
  await writer.addKey('读', dou, AceKeyKind.Headword);
  await writer.addKey('讀', dou, AceKeyKind.Variant);
  await writer.addKey('读书', dushu, AceKeyKind.Headword);
  await writer.addMeta(['读', 'freq', 12]);
  writer.addTag(['v', 'partOfSpeech', 0, 'verb', 0]);
  writer.setStyles('[data-sc-x] { color: red }');
  await writer.addAsset('img/a.png', new Uint8Array([137, 80, 78, 71]));
  const { blob } = await writer.finish({
    id,
    title,
    revision: '1',
    source: { format: 'yomitan' },
  });
  return blob!;
}

describe('dictionary database', () => {
  let db: AceDatabase;

  beforeEach(async () => {
    db = await openDatabase();
  });

  afterEach(async () => {
    db.close();
    await deleteDB(DB_NAME);
  });

  it('imports a .ace with progress, lists it, and answers lookups', async () => {
    const stages: string[] = [];
    const rec = await importAce(await makeAce('test:a', 'Dict A'), {
      db,
      batchSize: 2,
      onProgress: (p: ImportProgress) => {
        if (stages[stages.length - 1] !== p.stage) stages.push(p.stage);
      },
    });
    expect(rec.n).toBe(1);
    expect(rec.status).toBe('ready');
    expect(rec.styles).toContain('color: red');
    expect(stages).toEqual(['open', 'entries', 'keys', 'meta', 'tags', 'assets', 'finish']);

    const list = await listDictionaries(db);
    expect(list.map((d) => d.id)).toEqual(['test:a']);
    const info = toDictionaryInfo(list[0]!);
    expect(info.title).toBe('Dict A');
    expect(info.counts.entries).toBe(3);
    expect(info.hasStyles).toBe(true);
    expect(await countDictionaryRows(1, db)).toEqual({
      entries: 3,
      keys: 5,
      meta: 1,
      tags: 1,
      kanji: 0,
      kanjiMeta: 0,
      assets: 1,
    });

    const matches = await queryCandidates(
      [
        { text: '读书', length: 2 },
        { text: '读', length: 1 },
      ],
      new Set([1]),
      db,
    );
    expect(matches.map((m) => [m.candidate.text, m.entry.id, m.kinds])).toEqual([
      ['读书', 2, [0]],
      ['读', 0, [0]],
      ['读', 1, [0]],
    ]);
    const variant = await queryCandidates([{ text: '讀', length: 1 }], new Set([1]), db);
    expect(variant.map((m) => m.kinds)).toEqual([[1], [1]]);
    expect(await queryCandidates([{ text: '读', length: 1 }], new Set([2]), db)).toEqual([]);

    const blob = await getAssetBlob(1, 'img/a.png', db);
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(4);
    expect(await getAssetBlob(1, 'missing.png', db)).toBeNull();
  });

  it('re-imports the same id in place and deletes cleanly', async () => {
    await importAce(await makeAce('test:a', 'Dict A'), { db });
    await importAce(await makeAce('test:b', 'Dict B'), { db });
    const again = await importAce(await makeAce('test:a', 'Dict A v2', 5), { db });
    expect(again.n).toBe(3);
    expect((await listDictionaries(db)).map((d) => [d.id, d.n])).toEqual([
      ['test:b', 2],
      ['test:a', 3],
    ]);
    // The old copy (n = 1) left no rows behind.
    const old = await countDictionaryRows(1, db);
    expect(Object.values(old).every((c) => c === 0)).toBe(true);
    expect((await countDictionaryRows(3, db)).entries).toBe(5);

    expect(await deleteDictionary('test:a', db)).toBe(true);
    expect(await deleteDictionary('test:a', db)).toBe(false);
    expect(await findDictionary('test:a', db)).toBeUndefined();
    const gone = await countDictionaryRows(3, db);
    expect(Object.values(gone).every((c) => c === 0)).toBe(true);
    expect((await countDictionaryRows(2, db)).entries).toBe(3);
  });

  it('rolls back on abort', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      importAce(await makeAce('test:a', 'Dict A', 40), {
        db,
        batchSize: 4,
        signal: controller.signal,
        onProgress: () => {
          if (++calls === 3) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ImportAbortedError);
    expect(await listDictionaries(db)).toEqual([]);
    const rows = await countDictionaryRows(1, db);
    expect(Object.values(rows).every((c) => c === 0)).toBe(true);
  });

  it('rejects non-ace files', async () => {
    await expect(importAce(new Blob(['not a zip']), { db })).rejects.toThrow(/zip/i);
    expect(await listDictionaries(db)).toEqual([]);
  });
});
