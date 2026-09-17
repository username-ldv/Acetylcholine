import { BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import {
  type AceEntry,
  AceFormatError,
  type AceKey,
  AceKeyKind,
  AceReader,
  AceWriter,
} from '../src/index.ts';

configure({ useWebWorkers: false });

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

describe('AceWriter / AceReader', () => {
  it('round-trips entries, keys, meta, tags, kanji, styles and assets across chunks', async () => {
    const writer = new AceWriter({ entriesPerChunk: 2, keysPerChunk: 3, generator: 'test/1' });

    const id0 = await writer.addEntry({
      headwords: ['读', '讀'],
      readings: [
        { text: 'dú', tags: ['pinyin'] },
        { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
      ],
      content: [{ type: 'text', text: 'to read' }],
      tags: ['v'],
      termTags: [],
      rules: [],
      score: 5,
      sequence: -1,
    });
    const id1 = await writer.addEntry({
      headwords: ['读', '讀'],
      readings: [{ text: 'dòu', tags: ['pinyin'] }],
      content: [
        {
          type: 'structured',
          content: {
            tag: 'div',
            content: ['pause in a sentence', { tag: 'img', path: 'img/a.png' }],
          },
        },
      ],
      tags: [],
      termTags: ['n'],
      rules: [],
      score: 0,
      sequence: 7,
    });
    for (let i = 0; i < 3; i++) {
      await writer.addEntry({
        headwords: [`w${i}`],
        readings: [],
        content: [{ type: 'html', html: `<b>${i}</b>` }],
        tags: [],
        termTags: [],
        rules: [],
        score: 0,
        sequence: -1,
      });
    }
    expect(id0).toBe(0);
    expect(id1).toBe(1);

    await writer.addKey('读', id0, AceKeyKind.Headword);
    await writer.addKey('讀', id0, AceKeyKind.Variant);
    await writer.addKey('读', id1, AceKeyKind.Headword);
    await writer.addKey('讀', id1, AceKeyKind.Variant);
    await writer.addKey('dú', id0, AceKeyKind.Reading);
    await writer.addKey('   ', id0, AceKeyKind.Alias); // ignored: empty after trim

    await writer.addMeta(['读', 'freq', { value: 12, displayValue: '12' }]);
    writer.addTag(['v', 'partOfSpeech', 0, 'verb', 0]);
    await writer.addKanji(['读', 'ドク', 'よ.む', '', ['read'], { strokes: '10' }]);
    await writer.addKanjiMeta(['读', 'freq', 3]);
    writer.setStyles('[data-sc-x="y"] { color: red; }');
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await writer.addAsset('img/a.png', png);
    await writer.addAsset('./img/a.png', png); // duplicate ignored
    await writer.addAsset('fonts/f.ttf', new TextEncoder().encode('not really a font'));

    const { manifest, blob } = await writer.finish({
      id: 'test:roundtrip',
      title: 'Round trip',
      revision: '1',
      sourceLanguage: 'zh',
      targetLanguage: 'zh',
      source: { format: 'custom' },
    });

    expect(blob).not.toBeNull();
    expect(manifest.aceVersion).toBe(1);
    expect(manifest.counts).toEqual({
      entries: 5,
      keys: 5,
      meta: 1,
      tags: 1,
      kanji: 1,
      kanjiMeta: 1,
      assets: 2,
    });
    expect(manifest.files.entries).toEqual([
      'entries/00001.jsonl',
      'entries/00002.jsonl',
      'entries/00003.jsonl',
    ]);
    expect(manifest.files.keys).toEqual(['keys/00001.jsonl', 'keys/00002.jsonl']);
    expect(manifest.files.styles).toBe('styles.css');
    expect(manifest.files.tags).toBe('tags.json');
    expect(manifest.files.assets).toEqual(['img/a.png', 'fonts/f.ttf']);
    expect([...manifest.readingTags].sort()).toEqual(['pinyin', 'zhuyin']);
    expect([...manifest.contentKinds].sort()).toEqual(['html', 'structured', 'text']);
    expect(manifest.generator).toBe('test/1');

    const reader = await AceReader.open(blob!);
    try {
      expect(reader.manifest).toEqual(manifest);
      const entries = await collect(reader.entries());
      expect(entries.map((e: AceEntry) => e.id)).toEqual([0, 1, 2, 3, 4]);
      expect(entries[0]!.headwords).toEqual(['读', '讀']);
      expect(entries[0]!.readings).toEqual([
        { text: 'dú', tags: ['pinyin'] },
        { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
      ]);
      expect(entries[1]!.content[0]).toMatchObject({ type: 'structured' });
      expect(entries[1]!.sequence).toBe(7);

      const keys = await collect(reader.keys());
      expect(keys).toEqual<AceKey[]>([
        ['读', 0, 0],
        ['讀', 0, 1],
        ['读', 1, 0],
        ['讀', 1, 1],
        ['dú', 0, 2],
      ]);

      expect(await collect(reader.meta())).toEqual([
        ['读', 'freq', { value: 12, displayValue: '12' }],
      ]);
      expect(await reader.tags()).toEqual([['v', 'partOfSpeech', 0, 'verb', 0]]);
      expect(await collect(reader.kanji())).toEqual([
        ['读', 'ドク', 'よ.む', '', ['read'], { strokes: '10' }],
      ]);
      expect(await collect(reader.kanjiMeta())).toEqual([['读', 'freq', 3]]);
      expect(await reader.styles()).toBe('[data-sc-x="y"] { color: red; }');
      expect(reader.hasAsset('img/a.png')).toBe(true);
      expect(Array.from((await reader.readAsset('img/a.png'))!)).toEqual(Array.from(png));
      expect(await reader.readAsset('missing.png')).toBeNull();

      const hits = await reader.findEntries('讀');
      expect(hits.map((h) => [h.entry.id, h.kinds])).toEqual([
        [0, [1]],
        [1, [1]],
      ]);
    } finally {
      await reader.close();
    }
  });

  it('normalizes readings and headwords and de-duplicates them', async () => {
    const writer = new AceWriter();
    await writer.addEntry({
      headwords: ['読む', '読む', ''],
      readings: [
        { text: ' よむ ', tags: ['kana', 'kana'] },
        { text: 'よむ', tags: ['hiragana'] },
        { text: '', tags: ['x'] },
      ],
      content: [],
      tags: [],
      termTags: [],
      rules: [],
      score: 0,
      sequence: -1,
    });
    const { blob } = await writer.finish({
      id: 't',
      title: 'T',
      revision: '1',
      source: { format: 'custom' },
    });
    const reader = await AceReader.open(blob!);
    const [entry] = await collect(reader.entries());
    expect(entry!.headwords).toEqual(['読む']);
    expect(entry!.readings).toEqual([{ text: 'よむ', tags: ['kana', 'hiragana'] }]);
    await reader.close();
  });

  it('rejects ids that go backwards and entries without headwords', async () => {
    const writer = new AceWriter();
    const base = {
      readings: [],
      content: [],
      tags: [],
      termTags: [],
      rules: [],
      score: 0,
      sequence: -1,
    };
    await writer.addEntry({ ...base, headwords: ['a'], id: 5 });
    await expect(writer.addEntry({ ...base, headwords: ['b'], id: 3 })).rejects.toThrow(
      /ascending/,
    );
    await expect(writer.addEntry({ ...base, headwords: [''] })).rejects.toThrow(/no headword/);
  });

  it('rejects files that are not .ace archives or have a newer version', async () => {
    await expect(AceReader.open(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(AceFormatError);

    const zipWriter = new ZipWriter(new BlobWriter('application/zip'));
    await zipWriter.add('readme.txt', new TextReader('hi'));
    const noManifest = await zipWriter.close();
    await expect(AceReader.open(noManifest)).rejects.toThrow(/manifest\.json is missing/);

    const zipWriter2 = new ZipWriter(new BlobWriter('application/zip'));
    await zipWriter2.add('manifest.json', new TextReader(JSON.stringify({ aceVersion: 99 })));
    const future = await zipWriter2.close();
    await expect(AceReader.open(future)).rejects.toThrow(/Unsupported \.ace version 99/);
  });
});
