import type { LanguageAdapter, ScanCandidate } from './types.ts';

const WORD_CHAR = /[\p{L}\p{M}\p{N}'’-]/u;

export function isLatinTextChar(ch: string): boolean {
  return ch.length > 0 && WORD_CHAR.test(ch);
}

/**
 * Candidates for space-separated scripts: prefixes that end on a word boundary, longest first
 * ("reading books" → ["reading books", "reading"]). Multi-word candidates are limited by
 * `maxLength` characters. Each candidate is offered as written and lower-cased.
 */
export function latinCandidates(text: string, maxLength: number): ScanCandidate[] {
  const out: ScanCandidate[] = [];
  let i = 0;
  let inWord = false;
  let count = 0;
  for (const ch of text) {
    if (count >= maxLength) break;
    const isWord = isLatinTextChar(ch);
    if (!isWord) {
      if (inWord) out.push({ text: text.slice(0, i).normalize('NFC'), length: i });
      inWord = false;
      if (!/\s/.test(ch) || i === 0) break;
    } else {
      inWord = true;
    }
    i += ch.length;
    count++;
  }
  if (inWord) out.push({ text: text.slice(0, i).normalize('NFC'), length: i });
  out.reverse();
  // Case-folded variants come right after their original so exact spelling wins.
  const expanded: ScanCandidate[] = [];
  for (const c of out) {
    expanded.push(c);
    const lower = c.text.toLowerCase();
    if (lower !== c.text) expanded.push({ text: lower, length: c.length });
  }
  return expanded;
}

export const englishAdapter: LanguageAdapter = {
  id: 'en',
  name: 'English',
  normalize: (text) => text.normalize('NFC'),
  candidates: latinCandidates,
  isTextChar: isLatinTextChar,
};
