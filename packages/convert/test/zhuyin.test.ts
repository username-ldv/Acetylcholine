import { describe, expect, it } from 'vitest';
import { pinyinToZhuyin } from '../src/zhuyin.ts';

describe('pinyinToZhuyin', () => {
  it('converts plain pinyin, removing spaces and marking neutral tones', () => {
    expect(pinyinToZhuyin('dú')).toBe('ㄉㄨˊ');
    expect(pinyinToZhuyin('dú shū')).toBe('ㄉㄨˊㄕㄨ');
    expect(pinyinToZhuyin('dì dao')).toBe('ㄉㄧˋ˙ㄉㄠ');
    expect(pinyinToZhuyin('lǜ')).toBe('ㄌㄩˋ');
    expect(pinyinToZhuyin('huār')).toBe('ㄏㄨㄚㄦ');
    expect(pinyinToZhuyin('Zhōngguó')).toBe('ㄓㄨㄥㄍㄨㄛˊ');
  });

  it('refuses abbreviations, non-pinyin text and half-converted results', () => {
    expect(pinyinToZhuyin('AA zhì')).toBeNull();
    expect(pinyinToZhuyin('Ā Q')).toBeNull();
    expect(pinyinToZhuyin('ng')).toBeNull();
    expect(pinyinToZhuyin('hm')).toBeNull();
    expect(pinyinToZhuyin('ㄉㄨˊ')).toBeNull();
    expect(pinyinToZhuyin('')).toBeNull();
    expect(pinyinToZhuyin('dú（旧读dòu）')).toBeNull();
  });
});
