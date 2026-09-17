import { describe, expect, it } from 'vitest';
import { cjkPrefixCandidates, getLanguageAdapter, latinCandidates } from '../src/language/index.ts';

describe('language adapters', () => {
  it('cjk: every prefix up to a stop character, longest first, in code points', () => {
    const c = cjkPrefixCandidates('读书人。不读', 16);
    expect(c.map((x) => x.text)).toEqual(['读书人', '读书', '读']);
    expect(c[0]!.length).toBe(3);
    const astral = cjkPrefixCandidates('𥥷a', 16);
    expect(astral.map((x) => [x.text, x.length])).toEqual([
      ['𥥷a', 3],
      ['𥥷', 2],
    ]);
  });

  it('cjk: respects maxLength and stops at whitespace', () => {
    expect(cjkPrefixCandidates('一二三四五', 3).map((x) => x.text)).toEqual([
      '一二三',
      '一二',
      '一',
    ]);
    expect(cjkPrefixCandidates(' 一', 3)).toEqual([]);
    expect(cjkPrefixCandidates('一 二', 3).map((x) => x.text)).toEqual(['一']);
  });

  it('latin: word-boundary prefixes with case-folded variants', () => {
    const c = latinCandidates('Reading books, quickly', 32);
    expect(c.map((x) => x.text)).toEqual(['Reading books', 'reading books', 'Reading', 'reading']);
    expect(c[0]!.length).toBe('Reading books'.length);
    expect(latinCandidates('word', 32).map((x) => x.text)).toEqual(['word']);
    expect(latinCandidates(', word', 32)).toEqual([]);
  });

  it('registry falls back sensibly', () => {
    expect(getLanguageAdapter('zh').id).toBe('zh');
    expect(getLanguageAdapter('zh-TW').id).toBe('zh');
    expect(getLanguageAdapter('en').id).toBe('en');
    expect(getLanguageAdapter('xx').id).toBe('zh');
  });
});
