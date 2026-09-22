import { describe, expect, it } from 'vitest';
import {
  type AnkiNoteData,
  ankiDuplicateQuery,
  buildAnkiFields,
  escapeAnkiSearch,
  expandAnkiTemplate,
} from '../src/anki.ts';

const note: AnkiNoteData = {
  expression: '圖片',
  headwords: ['圖片', '图片'],
  readings: [
    { text: 'tú piàn', tags: ['pinyin'] },
    { text: 'ㄊㄨˊㄆㄧㄢˋ', tags: ['zhuyin'] },
  ],
  glossary: [
    { dictionary: 'moe', title: '兩岸詞典', html: '<p>圖畫、照片</p>', text: '圖畫、照片' },
    { dictionary: 'hanyu', title: '现代汉语词典', html: '<b>图片</b>', text: '图片' },
  ],
  sentence: { prefix: '這本雜誌刊登', body: '圖片', suffix: '，很好看。' },
  url: 'https://example.com/a?b=1&c=2',
  documentTitle: 'A <title>',
};
const ctx = { readingTags: ['zhuyin', 'pinyin'] };

describe('expandAnkiTemplate', () => {
  it('expands word markers', () => {
    expect(expandAnkiTemplate('{expression}|{headwords}|{variants}', note, ctx)).toBe(
      '圖片|圖片 / 图片|图片',
    );
  });

  it('picks readings by the profile preference or by tag', () => {
    expect(expandAnkiTemplate('{reading}', note, ctx)).toBe('ㄊㄨˊㄆㄧㄢˋ');
    expect(expandAnkiTemplate('{reading}', note, { readingTags: ['pinyin'] })).toBe('tú piàn');
    expect(expandAnkiTemplate('{reading:pinyin}', note, ctx)).toBe('tú piàn');
    expect(expandAnkiTemplate('{reading:kana}', note, ctx)).toBe('');
    expect(expandAnkiTemplate('{readings}', note, ctx)).toBe('tú piàn / ㄊㄨˊㄆㄧㄢˋ');
  });

  it('renders the glossary with titles, or one dictionary without', () => {
    const all = expandAnkiTemplate('{glossary}', note, ctx);
    expect(all).toContain('<div class="ace-glossary">');
    expect(all).toContain('<div class="ace-glossary-title">兩岸詞典</div><p>圖畫、照片</p>');
    expect(all).toContain('data-dictionary="现代汉语词典" data-dictionary-id="hanyu"');
    const one =
      '<div class="ace-glossary-entry" data-dictionary="现代汉语词典" data-dictionary-id="hanyu"><b>图片</b></div>';
    expect(expandAnkiTemplate('{glossary:hanyu}', note, ctx)).toBe(one);
    expect(expandAnkiTemplate('{glossary:现代汉语词典}', note, ctx)).toBe(one);
    expect(expandAnkiTemplate('{glossary:nope}', note, ctx)).toBe('');
  });

  it('links a dictionary stylesheet unless styles are switched off', () => {
    const styled: AnkiNoteData = {
      ...note,
      glossary: [{ ...note.glossary[0]!, stylesheet: '_ace-moe.css' }, note.glossary[1]!],
    };
    const link = '<link rel="stylesheet" href="_ace-moe.css">';
    expect(expandAnkiTemplate('{glossary}', styled, ctx)).toContain(
      `data-dictionary-id="moe">${link}<div class="ace-glossary-title">`,
    );
    expect(expandAnkiTemplate('{glossary:moe}', styled, ctx)).toContain(link);
    expect(
      expandAnkiTemplate('{glossary}', styled, { ...ctx, glossaryStyles: false }),
    ).not.toContain('<link');
  });

  it('renders text-only glossary markers', () => {
    expect(expandAnkiTemplate('{glossary-text}', note, ctx)).toBe(
      '兩岸詞典<br>圖畫、照片<br><br>现代汉语词典<br>图片',
    );
    expect(expandAnkiTemplate('{dictionary} / {dictionaries}', note, ctx)).toBe(
      '兩岸詞典 / 兩岸詞典, 现代汉语词典',
    );
  });

  it('splits the sentence around the match and escapes text markers', () => {
    expect(expandAnkiTemplate('{sentence}', note, ctx)).toBe('這本雜誌刊登圖片，很好看。');
    expect(expandAnkiTemplate('{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}', note, ctx)).toBe(
      '這本雜誌刊登<b>圖片</b>，很好看。',
    );
    expect(expandAnkiTemplate('{url} {document-title}', note, ctx)).toBe(
      'https://example.com/a?b=1&amp;c=2 A &lt;title&gt;',
    );
    expect(expandAnkiTemplate('{sentence}', { ...note, sentence: null }, ctx)).toBe('');
  });

  it('leaves unknown markers and braces alone', () => {
    expect(expandAnkiTemplate('{{c1::{expression}}} {nope} {}', note, ctx)).toBe(
      '{{c1::圖片}} {nope} {}',
    );
  });
});

describe('buildAnkiFields', () => {
  it('expands every template and drops empty ones', () => {
    expect(
      buildAnkiFields({ Word: '{expression}', Reading: '{reading}', Image: '  ' }, note, ctx),
    ).toEqual({ Word: '圖片', Reading: 'ㄊㄨˊㄆㄧㄢˋ' });
  });
});

describe('ankiDuplicateQuery', () => {
  it('escapes search metacharacters and scopes to the deck on request', () => {
    expect(escapeAnkiSearch('a*b_c"d\\e')).toBe('a\\*b\\_c\\"d\\\\e');
    expect(ankiDuplicateQuery({ model: 'CN Mining', field: 'Word', value: '圖片' })).toBe(
      '"note:CN Mining" "Word:圖片"',
    );
    expect(ankiDuplicateQuery({ model: 'M', field: 'F', value: 'a_b', deck: 'Deck::Sub' })).toBe(
      '"note:M" "F:a\\_b" "deck:Deck::Sub"',
    );
  });
});
