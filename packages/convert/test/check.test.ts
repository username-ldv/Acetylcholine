import { BlobWriter, configure, TextReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { checkYomitanEditions } from '../src/index.ts';

configure({ useWebWorkers: false });

async function makeZip(files: Record<string, string | object>): Promise<Blob> {
  const zip = new ZipWriter(new BlobWriter('application/zip'));
  for (const [name, data] of Object.entries(files)) {
    await zip.add(name, new TextReader(typeof data === 'string' ? data : JSON.stringify(data)));
  }
  return zip.close();
}

const content = (reading: string) => [
  {
    type: 'structured-content',
    content: ['gloss', { tag: 'span', content: reading, data: { readingTag: 'pinyin' } }],
  },
];

describe('checkYomitanEditions', () => {
  it('reports sequencing, empty terms, reading tags, css rules, and cross-edition differences', async () => {
    const pinyin = await makeZip({
      'index.json': { title: 'P', revision: '1', format: 3, sequenced: true },
      'term_bank_1.json': [
        ['讀', 'dú', '', '', 0, content('dú'), 1, ''],
        ['读', 'dú', '', '', 0, content('dú'), 1, ''],
        ['', 'x', '', '', 0, ['ghost'], 2, ''],
      ],
      'styles.css': '/* c */ [data-sc-reading-tag="zhuyin"] { display: none; } a { color: red; }',
    });
    const zhuyin = await makeZip({
      'index.json': { title: 'Z', revision: '1', format: 3 },
      'term_bank_1.json': [
        ['讀', 'ㄉㄨˊ', '', '', 0, content('dú'), 1, ''],
        ['读', 'ㄉㄨˊ', '', '', 0, content('ㄉㄨˊ'), 1, ''], // content differs
        ['鬼', 'x', '', '', 0, ['ghost'], 3, ''], // term and sequence differ
      ],
    });
    const report = await checkYomitanEditions([pinyin, zhuyin]);
    expect(report.editions).toHaveLength(2);
    expect(report.editions[0]).toMatchObject({
      title: 'P',
      sequenced: true,
      rows: 3,
      emptyTerms: 1,
      distinctSequences: 2,
      sharedSequences: 1,
      rowsWithReadingTag: 2,
      readingTagCssSelectors: ['[data-sc-reading-tag="zhuyin"]'],
    });
    expect(report.editions[1]).toMatchObject({
      sequenced: false,
      emptyTerms: 0,
      readingTagCssSelectors: [],
    });
    expect(report.comparisons).toHaveLength(1);
    expect(report.comparisons[0]).toEqual({
      aligned: false,
      rowCountsMatch: true,
      contentDiffers: 1,
      termDiffers: 1,
      sequenceDiffers: 1,
      contentDiffExamples: ['读'],
    });
  });

  it('marks identical editions as aligned with no content differences', async () => {
    const mk = (title: string, reading: string) =>
      makeZip({
        'index.json': { title, revision: '1', format: 3, sequenced: true },
        'term_bank_1.json': [['讀', reading, '', '', 0, content('dú'), 1, '']],
      });
    const report = await checkYomitanEditions([await mk('P', 'dú'), await mk('Z', 'ㄉㄨˊ')]);
    expect(report.comparisons[0]).toMatchObject({ aligned: true, contentDiffers: 0 });
  });
});
