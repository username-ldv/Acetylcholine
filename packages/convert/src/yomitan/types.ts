/** Yomitan / Yomichan dictionary file shapes (format 1–3). */

export interface YomitanIndex {
  title: string;
  revision: string;
  format?: 1 | 2 | 3;
  version?: 1 | 2 | 3;
  sequenced?: boolean;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  frequencyMode?: 'occurrence-based' | 'rank-based';
  minimumYomitanVersion?: string;
  isUpdatable?: boolean;
  indexUrl?: string;
  downloadUrl?: string;
  tagMeta?: Record<string, { category?: string; order?: number; notes?: string; score?: number }>;
}

export interface YomitanImageGlossary {
  type: 'image';
  path: string;
  [key: string]: unknown;
}

export type YomitanGlossaryItem =
  | string
  | { type: 'text'; text: string }
  | YomitanImageGlossary
  | { type: 'structured-content'; content: unknown }
  | [term: string, rules: string[]];

export type YomitanTermV3 = [
  term: string,
  reading: string,
  definitionTags: string | null,
  rules: string,
  score: number,
  glossary: YomitanGlossaryItem[],
  sequence: number,
  termTags: string,
];

export type YomitanTermV1 = [
  term: string,
  reading: string,
  definitionTags: string | null,
  rules: string,
  score: number,
  ...glossary: string[],
];

export type YomitanTermMeta = [term: string, kind: 'freq' | 'pitch' | 'ipa', data: unknown];

export type YomitanTag = [
  name: string,
  category: string,
  order: number,
  notes: string,
  score: number,
];

export type YomitanKanjiV3 = [
  character: string,
  onyomi: string,
  kunyomi: string,
  tags: string,
  meanings: string[],
  stats: Record<string, string>,
];

export type YomitanKanjiV1 = [
  character: string,
  onyomi: string,
  kunyomi: string,
  tags: string,
  ...meanings: string[],
];

export type YomitanKanjiMeta = [character: string, kind: 'freq', data: unknown];
