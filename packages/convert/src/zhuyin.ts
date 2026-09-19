/**
 * Optional pinyin → zhuyin derivation for MDX dictionaries, which carry one reading system. Uses
 * `pinyin-to-zhuyin` (MIT), the same converter the Yomitan exports were made with, so derived
 * readings match those editions and group with them in the popup.
 */
// @ts-expect-error pinyin-to-zhuyin ships no type declarations
import { p2z as untypedP2z } from 'pinyin-to-zhuyin';

const p2z: (pinyin: string) => string = untypedP2z;

/** Letters (with tone marks), ü/ê, separators. Anything else is not a plain pinyin reading. */
const PINYIN_RE = /^[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüêḿńňǹ\s'’·-]+$/i;
const LEFTOVER_RE = /[a-z0-9]/i;

/**
 * Zhuyin for a pinyin reading with spaces removed (`dú shū` → `ㄉㄨˊㄕㄨ`, `dì dao` → `ㄉㄧˋ˙ㄉㄠ`).
 * Returns null for readings that are not plain pinyin (`AA zhì`, `阿Q`'s `Ā Q`: any all-uppercase
 * word is a Latin abbreviation) and when the conversion leaves letters or tone digits behind
 * (`ng`, `hm`), so nothing half-converted reaches the dictionary.
 */
export function pinyinToZhuyin(reading: string): string | null {
  const text = reading.trim();
  if (text.length === 0 || !PINYIN_RE.test(text)) return null;
  if (text.split(/[\s'’·-]+/).some((word) => /^[A-Z]+$/.test(word))) return null;
  let out: string;
  try {
    out = p2z(text.toLowerCase());
  } catch {
    return null;
  }
  out = out.replace(/\s+/g, '');
  if (out.length === 0 || LEFTOVER_RE.test(out)) return null;
  return out;
}
