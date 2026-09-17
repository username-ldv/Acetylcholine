import type { AceCounts, AceEntry, AceKeyKind, AceReading } from '@acetylcholine/ace';

/** What the extension knows about an installed dictionary (the manifest minus file lists). */
export interface DictionaryInfo {
  /** Manifest id; stable across revisions. */
  id: string;
  /** Small integer used as the dictionary column in every IndexedDB row. */
  n: number;
  title: string;
  revision: string;
  author?: string;
  description?: string;
  attribution?: string;
  url?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  readingTags: string[];
  contentKinds: string[];
  counts: AceCounts;
  /** Bytes of the imported `.ace` file (compressed). */
  fileSize: number;
  hasStyles: boolean;
  importedAt: number;
  sourceFormat: string;
}

/** One key match, before grouping. */
export interface LookupHit {
  dictionary: string;
  entry: AceEntry;
  kinds: AceKeyKind[];
  /** The candidate text that matched. */
  matched: string;
  /** UTF-16 length of the raw scanned text the match covers. */
  length: number;
}

export interface LookupEntry {
  dictionary: string;
  entry: AceEntry;
  kinds: AceKeyKind[];
}

/** Entries from several dictionaries that describe the same word with the same pronunciation. */
export interface LookupGroup {
  matched: string;
  length: number;
  /** Union of headwords; the first is canonical. */
  headwords: string[];
  /** Union of readings (merged by text, tags unioned). */
  readings: AceReading[];
  entries: LookupEntry[];
  score: number;
}

export interface LookupResult {
  /** Raw text that was scanned. */
  text: string;
  groups: LookupGroup[];
  /** UTF-16 length of the longest match (0 = nothing found). */
  matchLength: number;
  /** Dictionaries referenced by the groups. */
  dictionaries: DictionaryInfo[];
  /** Milliseconds spent in the lookup service. */
  elapsed: number;
  cached: boolean;
}
