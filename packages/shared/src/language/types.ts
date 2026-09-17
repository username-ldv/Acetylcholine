/**
 * Language adapters turn scanned text into lookup candidates. They are the only place with
 * language-specific rules (word boundaries, deinflection, case folding).
 */

export interface ScanCandidate {
  /** Normalized text to look up (NFC). */
  text: string;
  /** Number of UTF-16 code units of the *raw* scanned text this candidate covers. */
  length: number;
}

export interface LanguageAdapter {
  /** Adapter id, ISO 639-1 where possible (`zh`, `ja`, `en`). */
  id: string;
  name: string;
  /** Normalizes a key or scanned text for matching. */
  normalize(text: string): string;
  /**
   * Candidate lookup strings for text that starts at index 0, longest first. `maxLength` is the
   * maximum number of characters (code points) a candidate may span.
   */
  candidates(text: string, maxLength: number): ScanCandidate[];
  /** True when the character may belong to a word (used to trim text before it is scanned). */
  isTextChar(ch: string): boolean;
}
