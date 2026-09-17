import { type AceEntry, AceKeyKind, AceReader, AceWriter } from '@acetylcholine/ace';
import { BlobWriter, configure, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { convertYomitan, stripReadingSystemSuffix } from '../src/index.ts';

configure({ useWebWorkers: false });

async function makeZip(files: Record<string, string | Uint8Array | object>): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, data] of Object.entries(files)) {
    if (data instanceof Uint8Array) await zip.add(name, new Uint8ArrayReader(data));
    else if (typeof data === 'string') await zip.add(name, new TextReader(data));
    else await zip.add(name, new TextReader(JSON.stringify(data)));
  }
  return zip.close();
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

/** Content in the shape the MOE converters produce: both terms and both reading systems inside. */
const sc = (trad: string, simp: string | null, gloss: string, altReading?: [string, string]) => ({
  type: 'structured-content',
  content: {
    tag: 'span',
    content: [
      { tag: 'span', content: trad, data: { moedict: 'traditional-term' } },
      ...(simp
        ? [{ tag: 'span', content: simp, data: { moedict: 'simplified-term' }, lang: 'zh-CN' }]
        : []),
      ...(altReading
        ? [
            {
              tag: 'span',
              content: [
                { tag: 'span', content: '又音', data: { moedict: 'alt-reading-label' } },
                {
                  tag: 'span',
                  content: altReading[1],
                  data: { moedict: 'alt-reading-content', readingTag: 'zhuyin' },
                },
                {
                  tag: 'span',
                  content: altReading[0],
                  data: { moedict: 'alt-reading-content', readingTag: 'pinyin' },
                },
              ],
              data: { moedict: 'alt-reading-parent' },
            },
          ]
        : []),
      { tag: 'span', content: [gloss], data: { moedict: 'definition-entry' } },
    ],
    lang: 'zh-TW',
  },
});

type Reading = (pinyin: string, zhuyin: string) => string;

/** A sequenced dictionary: trad + simp rows share a sequence; both editions share everything. */
function sequencedBank(reading: Reading) {
  return [
    ['讀', reading('dòu', 'ㄉㄡˋ'), 'n', '', 0, [sc('讀', '读', 'pause')], 1, ''],
    ['读', reading('dòu', 'ㄉㄡˋ'), 'n', '', 0, [sc('讀', '读', 'pause')], 1, ''],
    ['讀', reading('dú', 'ㄉㄨˊ'), 'v', '', 10, [sc('讀', '读', 'to read')], 2, 'common'],
    ['读', reading('dú', 'ㄉㄨˊ'), 'v', '', 10, [sc('讀', '读', 'to read')], 2, 'common'],
    // two pronunciations with identical content → one entry with two readings
    [
      '誰',
      reading('shéi', 'ㄕㄟˊ'),
      '',
      '',
      0,
      [sc('誰', '谁', 'who', ['shuí', 'ㄕㄨㄟˊ'])],
      3,
      '',
    ],
    [
      '誰',
      reading('shuí', 'ㄕㄨㄟˊ'),
      '',
      '',
      0,
      [sc('誰', '谁', 'who', ['shuí', 'ㄕㄨㄟˊ'])],
      3,
      '',
    ],
    [
      '谁',
      reading('shéi', 'ㄕㄟˊ'),
      '',
      '',
      0,
      [sc('誰', '谁', 'who', ['shuí', 'ㄕㄨㄟˊ'])],
      3,
      '',
    ],
    [
      '谁',
      reading('shuí', 'ㄕㄨㄟˊ'),
      '',
      '',
      0,
      [sc('誰', '谁', 'who', ['shuí', 'ㄕㄨㄟˊ'])],
      3,
      '',
    ],
    // identical content but different sequences → different entries
    ['犬', reading('quǎn', 'ㄑㄩㄢˇ'), '', '', 0, ['dog'], 4, ''],
    ['狗', reading('gǒu', 'ㄍㄡˇ'), '', '', 0, ['dog'], 5, ''],
    [
      '圖',
      reading('tú', 'ㄊㄨˊ'),
      '',
      '',
      0,
      [
        { type: 'text', text: 'picture' },
        { type: 'image', path: 'img/pic.png', width: 10, height: 10, description: 'a picture' },
        ['图', ['variant']],
      ],
      6,
      '',
    ],
  ];
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const baseCss = '[data-sc-moedict="traditional-term"] { color: red; }\n';

function pinyinZip() {
  return makeZip({
    'index.json': {
      title: 'Test 拼音',
      revision: '1.0',
      format: 3,
      sequenced: true,
      author: 'me',
      sourceLanguage: 'zh',
      targetLanguage: 'zh',
      attribution: 'nobody',
    },
    'term_bank_1.json': sequencedBank((p) => p),
    'term_meta_bank_1.json': [['讀', 'freq', 5]],
    'tag_bank_1.json': [['v', 'partOfSpeech', 0, 'verb', 0]],
    'kanji_bank_1.json': [['讀', 'ドク', 'よ.む', '', ['read'], { strokes: '22' }]],
    'kanji_meta_bank_1.json': [['讀', 'freq', 1]],
    'styles.css': `${baseCss}[data-sc-reading-tag="zhuyin"] {\n  display: none;\n}\n`,
    'img/pic.png': png,
  });
}

function zhuyinZip() {
  return makeZip({
    'index.json': {
      title: 'Test 注音',
      revision: '1.0',
      format: 3,
      sequenced: true,
      sourceLanguage: 'zh',
    },
    'term_bank_1.json': sequencedBank((_, z) => z),
    'term_meta_bank_1.json': [['讀', 'freq', 5]],
    'tag_bank_1.json': [['v', 'partOfSpeech', 0, 'verb', 0]],
    'styles.css': `${baseCss}[data-sc-reading-tag="pinyin"] {\n  display: none;\n}\n`,
    'img/pic.png': png,
  });
}

const byHeadword = (entries: AceEntry[], hw: string) =>
  entries.filter((e) => e.headwords[0] === hw);

describe('convertYomitan (sequenced dictionaries)', () => {
  it('merges rows by sequence + content: headwords and readings unioned, keys kept', async () => {
    const { manifest, blob } = await convertYomitan(await pinyinZip(), new AceWriter(), {
      generator: 'test',
    });
    expect(manifest.title).toBe('Test 拼音');
    expect(manifest.id).toMatch(/^yomitan:test-[0-9a-f]{12}$/);
    expect(manifest.readingTags).toEqual(['pinyin']);
    expect(manifest.sequenced).toBe(true);
    expect(manifest.counts).toMatchObject({
      entries: 6,
      meta: 1,
      tags: 1,
      kanji: 1,
      kanjiMeta: 1,
      assets: 1,
    });
    expect([...manifest.contentKinds].sort()).toEqual([
      'deinflection',
      'image',
      'structured',
      'text',
    ]);
    expect(manifest.source).toMatchObject({ format: 'yomitan', formatVersion: 3 });

    const reader = await AceReader.open(blob!);
    try {
      const entries = await collect(reader.entries());
      expect(entries).toHaveLength(6);

      const du = byHeadword(entries, '讀');
      expect(du).toHaveLength(2);
      expect(du[0]!.headwords).toEqual(['讀', '读']);
      expect(du[0]!.readings).toEqual([{ text: 'dòu', tags: ['pinyin'] }]);
      expect(du[0]!.tags).toEqual(['n']);
      expect(du[0]!.sequence).toBe(1);
      expect(du[1]!.readings).toEqual([{ text: 'dú', tags: ['pinyin'] }]);
      expect(du[1]!.termTags).toEqual(['common']);
      expect(du[1]!.score).toBe(10);

      const shei = byHeadword(entries, '誰');
      expect(shei).toHaveLength(1);
      expect(shei[0]!.headwords).toEqual(['誰', '谁']);
      expect(shei[0]!.readings).toEqual([
        { text: 'shéi', tags: ['pinyin'] },
        { text: 'shuí', tags: ['pinyin'] },
      ]);

      // identical content under different sequences stays apart
      expect(byHeadword(entries, '犬')).toHaveLength(1);
      expect(byHeadword(entries, '狗')).toHaveLength(1);

      const tu = byHeadword(entries, '圖')[0]!;
      expect(tu.content).toEqual([
        { type: 'text', text: 'picture' },
        { type: 'image', path: 'img/pic.png', width: 10, height: 10, description: 'a picture' },
        { type: 'deinflection', term: '图', rules: ['variant'] },
      ]);

      const keys = await collect(reader.keys());
      const duKeys = keys.filter(([, id]) => id === du[1]!.id).map(([k, , kind]) => [k, kind]);
      expect(duKeys).toEqual([
        ['讀', AceKeyKind.Headword],
        ['读', AceKeyKind.Headword],
      ]);
      expect(keys.filter(([k]) => k === '读')).toHaveLength(2);
      expect(keys.filter(([, , kind]) => kind !== AceKeyKind.Headword)).toHaveLength(0);
      // every row term is reachable exactly once per entry
      expect(keys).toHaveLength(2 + 2 + 2 + 1 + 1 + 1);

      expect(await collect(reader.meta())).toEqual([['讀', 'freq', 5]]);
      expect(await reader.tags()).toEqual([['v', 'partOfSpeech', 0, 'verb', 0]]);
      expect(await collect(reader.kanji())).toHaveLength(1);
      expect(await collect(reader.kanjiMeta())).toEqual([['讀', 'freq', 1]]);
      expect(Array.from((await reader.readAsset('img/pic.png'))!)).toEqual(Array.from(png));

      // reading-tag hide rules are stripped, the rest of the css is kept
      const styles = await reader.styles();
      expect(styles).toContain('traditional-term');
      expect(styles).not.toContain('data-sc-reading-tag');
    } finally {
      await reader.close();
    }
  });

  it('merges a pinyin and a zhuyin edition into one entry per sense with tagged readings', async () => {
    const { manifest, blob } = await convertYomitan(
      [await pinyinZip(), await zhuyinZip()],
      new AceWriter(),
      { indexReadings: true },
    );
    expect(manifest.title).toBe('Test');
    expect([...manifest.readingTags].sort()).toEqual(['pinyin', 'zhuyin']);
    expect(manifest.counts.entries).toBe(6);
    expect(manifest.counts.meta).toBe(1);
    expect(manifest.counts.tags).toBe(1);
    expect(manifest.counts.assets).toBe(1);
    expect((manifest.source as unknown as { sources: unknown[] }).sources).toHaveLength(2);

    const reader = await AceReader.open(blob!);
    try {
      const entries = await collect(reader.entries());
      const du = byHeadword(entries, '讀');
      expect(du[1]!.headwords).toEqual(['讀', '读']);
      expect(du[1]!.readings).toEqual([
        { text: 'dú', tags: ['pinyin'] },
        { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
      ]);
      const shei = byHeadword(entries, '誰')[0]!;
      expect(shei.readings.map((r) => r.text)).toEqual(['shéi', 'shuí', 'ㄕㄟˊ', 'ㄕㄨㄟˊ']);

      const keys = await collect(reader.keys());
      const readingKeys = keys.filter(
        ([, id, kind]) => id === du[1]!.id && kind === AceKeyKind.Reading,
      );
      expect(readingKeys.map(([k]) => k)).toEqual(['dú', 'ㄉㄨˊ']);
      // both editions' css collapse to one copy of the shared rules, hide rules gone
      const styles = (await reader.styles())!;
      expect(styles.split('traditional-term').length).toBe(2);
      expect(styles).not.toContain('data-sc-reading-tag');
    } finally {
      await reader.close();
    }
  });

  it('keeps every row when merging is disabled', async () => {
    const { manifest } = await convertYomitan(await pinyinZip(), new AceWriter(), { merge: false });
    expect(manifest.counts.entries).toBe(11);
  });
});

describe('convertYomitan (unsequenced dictionaries)', () => {
  const guifanLike = (simp: string, trad: string, gloss: string) => ({
    type: 'structured-content',
    content: {
      tag: 'span',
      content: [
        { tag: 'span', content: [simp], data: { guifan: 'simp' } },
        { tag: 'span', content: trad, data: { guifan: 'trad' }, lang: 'zh-TW' },
        gloss,
      ],
    },
  });
  const rows = [
    ['读', 'dú', '', '', 0, [guifanLike('读', '讀', 'to read')], 0, ''],
    ['讀', 'dú', '', '', 0, [guifanLike('读', '讀', 'to read')], 0, ''],
    ['谁', 'shéi', '', '', 0, ['who'], 0, ''],
    ['谁', 'shuí', '', '', 0, ['who'], 0, ''],
  ];

  it('merges by headword set + content only, so trad/simp rows stay apart by default', async () => {
    const zip = await makeZip({
      'index.json': { title: 'Plain', revision: '1', format: 3 },
      'term_bank_1.json': rows,
    });
    const { manifest, blob } = await convertYomitan(zip, new AceWriter());
    expect(manifest.sequenced).toBe(false);
    expect(manifest.counts.entries).toBe(3);
    const reader = await AceReader.open(blob!);
    const entries = await collect(reader.entries());
    expect(entries.map((e) => e.headwords)).toEqual([['读'], ['讀'], ['谁']]);
    expect(entries[2]!.readings.map((r) => r.text)).toEqual(['shéi', 'shuí']);
    await reader.close();
  });

  it('can opt in to variant markers embedded in content', async () => {
    const zip = await makeZip({
      'index.json': { title: 'Plain', revision: '1', format: 3 },
      'term_bank_1.json': rows,
    });
    const { manifest, blob } = await convertYomitan(zip, new AceWriter(), {
      variantDataValues: ['trad', 'simp'],
    });
    expect(manifest.counts.entries).toBe(2);
    const reader = await AceReader.open(blob!);
    const [du] = await collect(reader.entries());
    expect(du!.headwords).toEqual(['读', '讀']);
    const keys = await collect(reader.keys());
    expect(keys.filter(([, id]) => id === du!.id)).toEqual([
      ['读', du!.id, AceKeyKind.Headword],
      ['讀', du!.id, AceKeyKind.Variant],
    ]);
    await reader.close();
  });

  it('honours explicit reading tags and title', async () => {
    const zip = await makeZip({
      'index.json': { title: 'Plain', revision: '1', format: 3 },
      'term_bank_1.json': rows,
    });
    const { manifest, blob } = await convertYomitan(zip, new AceWriter(), {
      readingTags: ['hanyu-pinyin'],
      title: 'Custom',
      id: 'custom:id',
    });
    expect(manifest.title).toBe('Custom');
    expect(manifest.id).toBe('custom:id');
    expect(manifest.readingTags).toEqual(['hanyu-pinyin']);
    const reader = await AceReader.open(blob!);
    const first = (await collect(reader.entries()))[0]!;
    expect(first.readings[0]!.tags).toEqual(['hanyu-pinyin']);
    await reader.close();
  });

  it('reads format 1 dictionaries', async () => {
    const zip = await makeZip({
      'index.json': { title: 'Old', revision: 'r', version: 1 },
      'term_bank_1.json': [['犬', 'いぬ', 'n', '', 0, 'dog', 'hound']],
      'kanji_bank_1.json': [['犬', 'ケン', 'いぬ', '', 'dog', 'canine']],
    });
    const { manifest, blob } = await convertYomitan(zip, new AceWriter());
    expect(manifest.source).toMatchObject({ formatVersion: 1 });
    const reader = await AceReader.open(blob!);
    const [entry] = await collect(reader.entries());
    expect(entry!.content).toEqual([
      { type: 'text', text: 'dog' },
      { type: 'text', text: 'hound' },
    ]);
    expect(entry!.readings).toEqual([{ text: 'いぬ', tags: ['kana'] }]);
    expect(await collect(reader.kanji())).toEqual([
      ['犬', 'ケン', 'いぬ', '', ['dog', 'canine'], {}],
    ]);
    await reader.close();
  });

  it('skips rows with an empty term, unless variant markers can recover the headword', async () => {
    const trad = (hw: string, gloss: string) => ({
      type: 'structured-content',
      content: [{ tag: 'span', content: hw, data: { moedict: 'traditional-term' } }, gloss],
    });
    const bank = [
      ['一一九', 'yī yī jiǔ', '', '', 0, [trad('一一九', 'emergency number')], 0, ''],
      ['', 'yī yī jiǔ', '', '', 0, [trad('一一九', 'emergency number')], 0, ''],
      ['', 'yī', '', '', 0, [trad('一', 'one')], 0, ''],
      ['', 'x', '', '', 0, ['ghost'], 0, ''],
      ['ok', '', '', '', 0, ['fine'], 0, ''],
    ];
    const zip = () =>
      makeZip({
        'index.json': { title: 'Quirky', revision: 'r', format: 3 },
        'term_bank_1.json': bank,
      });

    const warnings: string[] = [];
    const plain = await convertYomitan(await zip(), new AceWriter(), {
      onWarning: (m) => warnings.push(m),
    });
    expect(plain.manifest.counts.entries).toBe(2);
    expect(warnings.some((w) => /skipped 3 row/.test(w))).toBe(true);

    const recovered = await convertYomitan(await zip(), new AceWriter(), {
      variantDataValues: ['traditional-term'],
    });
    expect(recovered.manifest.counts.entries).toBe(3);
    const reader = await AceReader.open(recovered.blob!);
    const entries = await collect(reader.entries());
    expect(entries.map((e) => e.headwords)).toEqual([['一一九'], ['一'], ['ok']]);
    await reader.close();
  });

  it('rejects zips without index.json', async () => {
    const zip = await makeZip({ 'term_bank_1.json': [] });
    await expect(convertYomitan(zip, new AceWriter())).rejects.toThrow(/index\.json/);
  });
});

describe('stripReadingSystemSuffix', () => {
  it('removes trailing reading-system words only', () => {
    expect(stripReadingSystemSuffix('现代汉语规范词典 拼音')).toBe('现代汉语规范词典');
    expect(stripReadingSystemSuffix('兩岸詞典 注音')).toBe('兩岸詞典');
    expect(stripReadingSystemSuffix('Dict (Pinyin)')).toBe('Dict');
    expect(stripReadingSystemSuffix('拼音')).toBe('拼音');
    expect(stripReadingSystemSuffix('JMdict')).toBe('JMdict');
  });
});
