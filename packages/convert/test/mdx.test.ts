import { type AceEntry, type AceKey, AceKeyKind, AceReader, AceWriter } from '@acetylcholine/ace';
import { configure } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import {
  type ConvertProgress,
  convertMdx,
  detectRecipe,
  type MdxRecord,
  type MdxSource,
  parseMdxTextExport,
  parseRecipe,
  ResourceIndex,
  rewriteRootSelectors,
} from '../src/index.ts';

configure({ useWebWorkers: false });

const encoder = new TextEncoder();
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function source(
  records: MdxRecord[],
  files: Record<string, string | Uint8Array> = {},
  extra: Partial<MdxSource> = {},
): MdxSource {
  return {
    title: 'Test MDX',
    ...extra,
    async *records() {
      yield* records;
    },
    resources: {
      list: () => Object.keys(files),
      get: async (name) => {
        const f = files[name];
        if (f === undefined) return null;
        return typeof f === 'string' ? encoder.encode(f) : f;
      },
    },
  };
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}

async function read(blob: Blob) {
  const reader = await AceReader.open(blob);
  try {
    return {
      entries: await collect(reader.entries()),
      keys: await collect(reader.keys()),
      styles: await reader.styles(),
      assets: reader.assetPaths(),
    };
  } finally {
    await reader.close();
  }
}

const htmlOf = (e: AceEntry) => (e.content[0] as { html: string }).html;
const keysFor = (keys: AceKey[], key: string) =>
  keys.filter((k) => k[0] === key).map(([, id, kind]) => [id, kind] as const);

// ---- 现代汉语词典 shape: <entry> per pronunciation, <hwg><hw>读（讀）</hw><pinyin>dú</pinyin> ---

const HANYU_CSS = [
  '@font-face { font-family: Heiti; src: url("hei.ttf"), url(missing.woff); }',
  'body { font-family: Songti, serif; }',
  'entry { display: block; }',
  'html body p { margin: 0 }',
].join('\n');

const hanyuRecords: MdxRecord[] = [
  {
    key: '读',
    html:
      '<link rel="stylesheet" type="text/css" href="XDHY7.css" />\n' +
      '<entry id="1"><hwg><hw>读（讀）</hw><pinyin>dòu</pinyin></hwg><def>pause; see <a href="entry://句读">句读</a> and <a href="entry://读#dú">dú</a>.</def></entry>' +
      '<entry id="2"><hwg><hw>读（讀）</hw><pinyin>dú</pinyin></hwg><def>read <img src="001.PNG"> <script>alert(1)</script><span onclick="x()" style="color: red; background: url(001.png)">x</span><a href="javascript:evil()">bad</a><a href="http://example.com/a">ext</a></def></entry>',
  },
  {
    key: '㖊',
    html: '<link rel="stylesheet" href="XDHY7.css" />\n<entry id="3"><hwg><hw>㖊（噚）</hw><pinyin>xún 又 yīngxún</pinyin></hwg><def>fathom</def></entry>',
  },
  {
    key: '㓦划',
    html: '<link rel="stylesheet" href="XDHY7.css" />\n<entry id="4"><hwg><hw>㓦划</hw><pinyin>bāi·hua（口语里多读bāi·huai）</pinyin></hwg><def>x</def></entry>',
  },
  {
    key: '辉',
    html: '<entry id="5"><hwg><hw>辉（輝、<sup>*</sup>煇）</hw><pinyin>huī</pinyin></hwg><def>shine</def></entry>',
  },
  { key: '讀書', html: '@@@LINK=读书' },
  { key: '㑳', html: '@@@LINK=读' },
  { key: '㑺', html: '@@@LINK=㑳' },
  { key: '讀', html: '@@@LINK=读' },
  { key: '0周期表', html: '<img style="display:block" src="1800.png">' },
  { key: 'empty', html: '   \n  ' },
];

const hanyuFiles = {
  'XDHY7.css': HANYU_CSS,
  '001.PNG': png,
  '1800.png': png,
  'hei.ttf': new Uint8Array([1, 2, 3]),
  'unused.png': png,
};

describe('convertMdx with the hanyu7 recipe (auto-detected)', () => {
  it('splits records into entries with readings, variants, aliases, assets and styles', async () => {
    const warnings: string[] = [];
    const stages = new Set<ConvertProgress['stage']>();
    const { manifest, blob, stats } = await convertMdx(
      source(hanyuRecords, hanyuFiles, { description: 'a test', revision: '2024-01-01' }),
      new AceWriter(),
      {
        generator: 'test',
        onWarning: (m) => warnings.push(m),
        onProgress: (p) => stages.add(p.stage),
      },
    );
    expect(stats.recipe).toBe('hanyu7');
    expect(stats.readingTag).toBe('pinyin');
    expect(stats).toMatchObject({ records: 10, links: 4, unresolvedLinks: 1, entries: 6 });
    expect(manifest.source).toMatchObject({ format: 'mdx', recipe: 'hanyu7', links: 4 });
    expect(manifest.title).toBe('Test MDX');
    expect(manifest.revision).toBe('2024-01-01');
    expect(manifest.description).toBe('a test');
    expect(manifest.id).toMatch(/^mdx:test-mdx-[0-9a-f]{12}$/);
    expect(manifest.readingTags).toEqual(['pinyin']);
    expect(manifest.contentKinds).toEqual(['html']);
    expect(manifest.sequenced).toBe(true);
    expect([...stages]).toEqual(
      expect.arrayContaining(['index', 'records', 'links', 'styles', 'assets', 'finish']),
    );
    expect(warnings.join('\n')).toContain('讀書 → 读书');
    expect(warnings.join('\n')).toContain('missing.woff');

    const { entries, keys, styles, assets } = await read(blob!);
    const du = entries.filter((e) => e.headwords[0] === '读');
    expect(du).toHaveLength(2);
    expect(du[0]!.headwords).toEqual(['读', '讀']);
    expect(du[0]!.readings).toEqual([{ text: 'dòu', tags: ['pinyin'] }]);
    expect(du[1]!.readings).toEqual([{ text: 'dú', tags: ['pinyin'] }]);
    expect(du[0]!.sequence).toBe(0);
    expect(du[1]!.sequence).toBe(0);

    const dou = htmlOf(du[0]!);
    expect(dou.startsWith('<entry id="1">')).toBe(true);
    expect(dou).toContain('<a href="ace-lookup:句读">句读</a>');
    expect(dou).toContain('<a href="ace-lookup:读">dú</a>');
    expect(dou).not.toContain('<link');
    const duHtml = htmlOf(du[1]!);
    expect(duHtml).toContain('<img src="ace-asset:001.PNG">');
    expect(duHtml).not.toContain('<script');
    expect(duHtml).not.toContain('onclick');
    expect(duHtml).toContain('style="color: red; background: url(&quot;ace-asset:001.PNG&quot;)"');
    expect(duHtml).toContain('<a>bad</a>');
    expect(duHtml).toContain('<a href="http://example.com/a">ext</a>');

    const xun = entries.find((e) => e.headwords[0] === '㖊')!;
    expect(xun.headwords).toEqual(['㖊', '噚']);
    expect(xun.readings.map((r) => r.text)).toEqual(['xún', 'yīngxún']);
    expect(entries.find((e) => e.headwords[0] === '㓦划')!.readings[0]!.text).toBe('bāi hua');
    expect(entries.find((e) => e.headwords[0] === '辉')!.headwords).toEqual(['辉', '輝', '煇']);

    const table = entries.find((e) => e.headwords[0] === '0周期表')!;
    expect(table.readings).toEqual([]);
    expect(htmlOf(table)).toBe('<img style="display:block" src="ace-asset:1800.png">');

    // keys: headword + variant per entry, aliases to every entry of the (chained) target
    expect(keysFor(keys, '读')).toEqual([
      [du[0]!.id, AceKeyKind.Headword],
      [du[1]!.id, AceKeyKind.Headword],
    ]);
    // 讀 is both a variant of 读 and a @@@LINK to it: the variant keys suffice, no alias is added
    expect(keysFor(keys, '讀')).toEqual([
      [du[0]!.id, AceKeyKind.Variant],
      [du[1]!.id, AceKeyKind.Variant],
    ]);
    expect(keysFor(keys, '㑳')).toEqual([
      [du[0]!.id, AceKeyKind.Alias],
      [du[1]!.id, AceKeyKind.Alias],
    ]);
    expect(keysFor(keys, '㑺')).toEqual([
      [du[0]!.id, AceKeyKind.Alias],
      [du[1]!.id, AceKeyKind.Alias],
    ]);
    expect(keysFor(keys, '讀書')).toEqual([]);
    expect(manifest.counts.keys).toBe(keys.length);

    // styles: hoisted once, urls rewritten, body → content root
    expect(styles).toContain('src: url("ace-asset:hei.ttf"), url(missing.woff)');
    expect(styles).toContain('.ace-html { font-family: Songti, serif; }');
    expect(styles).toContain('.ace-html p { margin: 0 }');
    expect(styles).toContain('entry { display: block; }');
    expect(styles?.match(/entry \{ display: block; \}/g)).toHaveLength(1);

    // assets: only referenced ones, never the stylesheet itself
    expect([...assets].sort()).toEqual(['001.PNG', '1800.png', 'hei.ttf']);
  });

  it('honours an explicit recipe name and reports unknown ones', async () => {
    const { stats, blob } = await convertMdx(source(hanyuRecords, hanyuFiles), new AceWriter(), {
      recipe: 'generic',
    });
    expect(stats.recipe).toBe('generic');
    expect(stats.readingTag).toBeNull();
    const { entries } = await read(blob!);
    const du = entries.filter((e) => e.headwords[0] === '读');
    expect(du).toHaveLength(1);
    expect(du[0]!.readings).toEqual([]);
    expect(htmlOf(du[0]!)).toContain('<entry id="1">');
    expect(htmlOf(du[0]!)).toContain('<entry id="2">');

    await expect(
      convertMdx(source(hanyuRecords), new AceWriter(), { recipe: 'nope' }),
    ).rejects.toThrow('Unknown MDX recipe "nope"');
  });

  it('can index readings as keys', async () => {
    const { blob } = await convertMdx(source(hanyuRecords.slice(0, 1)), new AceWriter(), {
      indexReadings: true,
    });
    const { keys } = await read(blob!);
    expect(keys.filter((k) => k[2] === AceKeyKind.Reading).map((k) => k[0])).toEqual(['dòu', 'dú']);
  });
});

// ---- 规范词典 shape: div.HYGF2 with <hr>-separated pronunciations -----------------------------

const guifanRecords: MdxRecord[] = [
  {
    key: '读',
    html:
      '<link rel="stylesheet" type="text/css" href="HYGF2.css"><div class="HYGF2"><x-hw>读</x-hw> <x-pr id="dòu">dòu</x-pr>（讀）\n' +
      '<dt><x-gram>名</x-gram>pause<x-f>。</x-f></dt><dd class="x-ext1"><x-ex>句<x-key>读</x-key></x-ex></dd>\n' +
      '<dt><x-ref>另见</x-ref><a href="#dú" type="seealso">dú</a></dt><hr>\n' +
      '<x-hw>读</x-hw> <x-pr id="dú">dú</x-pr>（讀）\n' +
      '<dt><x-sn>①</x-sn>read</dt><span class="collapse"><span class="unbox"><span class="x-lb" onclick="toggle_active(this);">用法说明</span><span class="t-note">note</span></span></span>' +
      '<script src="HYGF2.js" type="text/javascript"></script><script>HYGF2();</script></div>',
  },
  {
    key: 'ABC',
    html: '<link rel="stylesheet" href="HYGF2.css"><div class="HYGF2"><x-hw>ABC</x-hw>\n<dt>basics<x-hwp>x</x-hwp> <x-pr>nope</x-pr></dt></div>',
  },
];

describe('convertMdx with the guifan2 recipe (auto-detected)', () => {
  it('splits at <hr>, keeps the container, reads x-pr from the header only', async () => {
    const { stats, blob } = await convertMdx(
      source(guifanRecords, { 'HYGF2.css': 'div.HYGF2 { line-height: 1.5em; }' }),
      new AceWriter(),
    );
    expect(stats.recipe).toBe('guifan2');
    expect(stats.entries).toBe(3);
    const { entries, styles } = await read(blob!);
    const du = entries.filter((e) => e.headwords[0] === '读');
    expect(du).toHaveLength(2);
    expect(du.map((e) => e.readings[0]!.text)).toEqual(['dòu', 'dú']);
    expect(du[0]!.headwords).toEqual(['读', '讀']);
    for (const e of du) {
      const html = htmlOf(e);
      expect(html.startsWith('<div class="HYGF2">')).toBe(true);
      expect(html.endsWith('</div>')).toBe(true);
      expect(html).not.toContain('<hr');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('onclick');
    }
    expect(htmlOf(du[0]!)).toContain('<a href="#dú" type="seealso">dú</a>');
    // the dictionary's toggle_active(this) becomes a declarative toggle on the parent .unbox
    expect(htmlOf(du[1]!)).toContain(
      '<span class="x-lb" data-ace-toggle="is-active" data-ace-toggle-target="parent">用法说明</span>',
    );
    const abc = entries.find((e) => e.headwords[0] === 'ABC')!;
    expect(abc.readings).toEqual([]);
    expect(abc.headwords).toEqual(['ABC']);
    // recipe CSS (dark-mode fixes) follows the dictionary's own sheet
    expect(styles?.startsWith('div.HYGF2 { line-height: 1.5em; }')).toBe(true);
    expect(styles).toContain('x-a, x-sn, x-m { color: inherit; }');
  });

  it('derives zhuyin readings from pinyin on request', async () => {
    const { stats, blob, manifest } = await convertMdx(
      source([
        ...hanyuRecords.slice(0, 3),
        {
          key: 'AA制',
          html: '<entry><hwg><hw>AA制</hw><pinyin>AA zhì</pinyin></hwg><def>x</def></entry>',
        },
      ]),
      new AceWriter(),
      { deriveZhuyin: true },
    );
    expect(stats.derivedReadings).toBe(5);
    expect(manifest.readingTags).toEqual(['pinyin', 'zhuyin']);
    const { entries } = await read(blob!);
    const du = entries.filter((e) => e.headwords[0] === '读');
    expect(du[0]!.readings).toEqual([
      { text: 'dòu', tags: ['pinyin'] },
      { text: 'ㄉㄡˋ', tags: ['zhuyin'] },
    ]);
    expect(entries.find((e) => e.headwords[0] === '㖊')!.readings.map((r) => r.text)).toEqual([
      'xún',
      'yīngxún',
      'ㄒㄩㄣˊ',
      'ㄧㄥㄒㄩㄣˊ',
    ]);
    expect(entries.find((e) => e.headwords[0] === '㓦划')!.readings[1]!.text).toBe('ㄅㄞ˙ㄏㄨㄚ');
    // Latin abbreviations are left alone
    expect(entries.find((e) => e.headwords[0] === 'AA制')!.readings).toEqual([
      { text: 'AA zhì', tags: ['pinyin'] },
    ]);
  });
});

describe('convertMdx fallbacks', () => {
  it('uses the generic recipe for unknown markup: one entry per record, no readings', async () => {
    const { stats, blob, manifest } = await convertMdx(
      source([
        { key: 'a', html: '<b>A</b> is for apple' },
        {
          key: 'b',
          html: '<html><head><style>b { color: red }</style></head><body><b>B</b></body></html>',
        },
      ]),
      new AceWriter(),
    );
    expect(stats.recipe).toBe('generic');
    expect(manifest.readingTags).toEqual([]);
    const { entries, styles } = await read(blob!);
    expect(entries.map(htmlOf)).toEqual(['<b>A</b> is for apple', '<b>B</b>']);
    expect(styles).toBe('b { color: red }');
  });

  it('validates user recipes', () => {
    expect(() => parseRecipe({ name: 'x', reading: { selector: 'p', split: '(' } })).toThrow(
      /reading\.split: must be a valid regular expression/,
    );
    const r = parseRecipe({ name: 'x', split: { each: 'entry' } });
    expect(r.name).toBe('x');
    expect(detectRecipe('anything', '<entry><hwg></hwg></entry>', [r]).name).toBe('hanyu7');
    expect(detectRecipe('t', '<p>x</p>', [{ name: 'mine', detect: { title: '^t$' } }]).name).toBe(
      'mine',
    );
  });
});

describe('parseMdxTextExport', () => {
  it('parses key / body / </> records with CRLF, BOM, multi-line bodies and links', async () => {
    const text =
      '﻿一\r\n<div>one\r\nline two</div>\r\n</>\r\n\r\n二\r\n@@@LINK=一\r\n</>\r\n三\n<p>3</p>\n</>';
    const records = await collect(parseMdxTextExport(text));
    expect(records).toEqual([
      { key: '一', html: '<div>one\nline two</div>' },
      { key: '二', html: '@@@LINK=一' },
      { key: '三', html: '<p>3</p>' },
    ]);
    const fromBlob = await collect(parseMdxTextExport(new Blob([text])));
    expect(fromBlob).toEqual(records);
    const fromBytes = await collect(parseMdxTextExport(encoder.encode(text)));
    expect(fromBytes).toEqual(records);
  });
});

describe('ResourceIndex', () => {
  it('resolves references exactly, case-insensitively and by base name', () => {
    const index = new ResourceIndex(['\\HYGF2.css', 'img/001.PNG', 'a/x.png', 'b/x.png']);
    expect(index.resolve('HYGF2.css')).toBe('HYGF2.css');
    expect(index.rawName('HYGF2.css')).toBe('\\HYGF2.css');
    expect(index.resolve('img/001.png')).toBe('img/001.PNG');
    expect(index.resolve('001.PNG')).toBe('img/001.PNG');
    expect(index.resolve('file:///img/001.PNG?x=1')).toBe('img/001.PNG');
    expect(index.resolve('x.png')).toBeNull();
    expect(index.resolve('nope.png')).toBeNull();
    expect(index.resolve('')).toBeNull();
  });
});

describe('rewriteRootSelectors', () => {
  it('maps html/body to the content root and leaves other selectors alone', () => {
    const css =
      'body{a:b}\nhtml body .x, tbody, .body { c: d }\n@media print { body > p { e: f } }';
    expect(rewriteRootSelectors(css)).toBe(
      '.ace-html {a:b}\n.ace-html .x, tbody, .body { c: d }\n@media print { .ace-html > p { e: f } }',
    );
    expect(rewriteRootSelectors('a { b: c }')).toBe('a { b: c }');
  });
});
