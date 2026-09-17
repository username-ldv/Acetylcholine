import type { LanguageAdapter, ScanCandidate } from './types.ts';

/** Punctuation and symbols that end a CJK scan. */
const CJK_STOP = /[\s　-〿＀-／：-＠［-｀｛-･ -⁯⸀-⹿!-/:-@[-`{-~ -¿←-⏿─-➿]/u;

/** Characters that never form part of a Chinese or Japanese word. */
export function isCjkTextChar(ch: string): boolean {
  return ch.length > 0 && !CJK_STOP.test(ch);
}

/**
 * Candidates for scripts without word separators: every prefix of the text up to the first stop
 * character, longest first. Lengths are measured in code points so astral characters (𥥷) are
 * never split.
 */
export function cjkPrefixCandidates(text: string, maxLength: number): ScanCandidate[] {
  const out: ScanCandidate[] = [];
  let units = 0;
  let count = 0;
  for (const ch of text) {
    if (count >= maxLength || !isCjkTextChar(ch)) break;
    units += ch.length;
    count++;
    out.push({ text: text.slice(0, units).normalize('NFC'), length: units });
  }
  out.reverse();
  return out;
}

export const chineseAdapter: LanguageAdapter = {
  id: 'zh',
  name: 'Chinese',
  normalize: (text) => text.normalize('NFC'),
  candidates: cjkPrefixCandidates,
  isTextChar: isCjkTextChar,
};

/** Japanese: prefix candidates only for now; deinflection is planned (Phase 8). */
export const japaneseAdapter: LanguageAdapter = {
  id: 'ja',
  name: 'Japanese',
  normalize: (text) => text.normalize('NFC'),
  candidates: cjkPrefixCandidates,
  isTextChar: isCjkTextChar,
};
