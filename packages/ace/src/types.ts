/**
 * Type definitions for the `.ace` dictionary format (v1).
 * See docs/ACE_FORMAT.md for the normative description.
 */

export const ACE_FORMAT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Structured content (Yomitan-compatible tree)
// ---------------------------------------------------------------------------

export type StructuredContent = string | StructuredContent[] | StructuredContentNode;

export type StructuredContentData = Record<string, string>;

export interface StructuredContentStyle {
  fontStyle?: 'normal' | 'italic';
  fontWeight?: 'normal' | 'bold';
  fontSize?: string;
  color?: string;
  background?: string;
  backgroundColor?: string;
  textDecorationLine?: string | string[];
  textDecorationStyle?: string;
  textDecorationColor?: string;
  borderColor?: string;
  borderStyle?: string;
  borderRadius?: string;
  borderWidth?: string;
  clipPath?: string;
  verticalAlign?: string;
  textAlign?: string;
  textEmphasis?: string;
  textShadow?: string;
  margin?: string;
  marginTop?: number | string;
  marginLeft?: number | string;
  marginRight?: number | string;
  marginBottom?: number | string;
  padding?: string;
  paddingTop?: string;
  paddingLeft?: string;
  paddingRight?: string;
  paddingBottom?: string;
  wordBreak?: string;
  whiteSpace?: string;
  cursor?: string;
  listStyleType?: string;
}

export interface ScBrNode {
  tag: 'br';
  data?: StructuredContentData;
}

export interface ScGenericNode {
  tag: 'ruby' | 'rt' | 'rp' | 'table' | 'thead' | 'tbody' | 'tfoot' | 'tr';
  content?: StructuredContent;
  data?: StructuredContentData;
  lang?: string;
}

export interface ScTableCellNode {
  tag: 'td' | 'th';
  content?: StructuredContent;
  data?: StructuredContentData;
  colSpan?: number;
  rowSpan?: number;
  style?: StructuredContentStyle;
  lang?: string;
}

export interface ScStyledNode {
  tag: 'span' | 'div' | 'ol' | 'ul' | 'li' | 'details' | 'summary';
  content?: StructuredContent;
  data?: StructuredContentData;
  style?: StructuredContentStyle;
  title?: string;
  open?: boolean;
  lang?: string;
}

export interface ImageOptions {
  width?: number;
  height?: number;
  title?: string;
  alt?: string;
  description?: string;
  pixelated?: boolean;
  imageRendering?: 'auto' | 'pixelated' | 'crisp-edges';
  appearance?: 'auto' | 'monochrome';
  background?: boolean;
  collapsed?: boolean;
  collapsible?: boolean;
}

export interface ScImageNode extends ImageOptions {
  tag: 'img';
  path: string;
  data?: StructuredContentData;
  verticalAlign?: string;
  border?: string;
  borderRadius?: string;
  sizeUnits?: 'px' | 'em';
}

export interface ScLinkNode {
  tag: 'a';
  href: string;
  content?: StructuredContent;
  lang?: string;
}

export type StructuredContentNode =
  | ScBrNode
  | ScGenericNode
  | ScTableCellNode
  | ScStyledNode
  | ScImageNode
  | ScLinkNode;

// ---------------------------------------------------------------------------
// Entry content blocks
// ---------------------------------------------------------------------------

export interface AceTextContent {
  type: 'text';
  text: string;
}

export interface AceStructuredContent {
  type: 'structured';
  content: StructuredContent;
}

/** Sanitized HTML (from MDX). Asset refs are `ace-asset:<path>`, internal links `ace-lookup:<term>`. */
export interface AceHtmlContent {
  type: 'html';
  html: string;
}

export interface AceImageContent extends ImageOptions {
  type: 'image';
  path: string;
}

export interface AceDeinflectionContent {
  type: 'deinflection';
  term: string;
  rules: string[];
}

export type AceContent =
  | AceTextContent
  | AceStructuredContent
  | AceHtmlContent
  | AceImageContent
  | AceDeinflectionContent;

export type AceContentKind = AceContent['type'];

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * One reading of an entry. `tags` carry the reading system (`pinyin`, `zhuyin`, `kana`, `ipa`, …)
 * and any qualifiers (`taiwan`, `colloquial`, …). The extension picks the primary reading to
 * display from the user's preferred tag order.
 */
export interface AceReading {
  text: string;
  tags: string[];
}

export interface AceEntry {
  /** Dense integer, unique within the dictionary, ascending in file order. */
  id: number;
  /** Display forms; index 0 is the canonical headword, the rest are variants. */
  headwords: string[];
  /**
   * Readings that all apply to this sense block: the same pronunciation in several systems, or
   * equivalent pronunciations sharing the content. Empty when the dictionary has no readings.
   * Pronunciations with *different* meanings are separate entries.
   */
  readings: AceReading[];
  content: AceContent[];
  /** Definition tags (names defined in tags.json). */
  tags: string[];
  /** Tags about the term itself. */
  termTags: string[];
  /** Deinflection rule identifiers. */
  rules: string[];
  /** Popularity score; higher sorts first. */
  score: number;
  /** Groups related entries; -1 when unset. */
  sequence: number;
}

export const AceKeyKind = {
  Headword: 0,
  Variant: 1,
  Reading: 2,
  Alias: 3,
} as const;
export type AceKeyKind = (typeof AceKeyKind)[keyof typeof AceKeyKind];

/** `[key, entryId, kind]` */
export type AceKey = [key: string, entryId: number, kind: AceKeyKind];

export type AceFrequencyValue = string | number | { value: number; displayValue?: string };

export type AceMetaFreqData = AceFrequencyValue | { reading: string; frequency: AceFrequencyValue };

export interface AcePitch {
  position: number | string;
  nasal?: number | number[];
  devoice?: number | number[];
  tags?: string[];
}

export interface AceMetaPitchData {
  reading: string;
  pitches: AcePitch[];
}

export interface AceMetaIpaData {
  reading: string;
  transcriptions: { ipa: string; tags?: string[] }[];
}

/** `[term, kind, data]` — identical to Yomitan term_meta_bank v3 rows. */
export type AceMeta =
  | [term: string, kind: 'freq', data: AceMetaFreqData]
  | [term: string, kind: 'pitch', data: AceMetaPitchData]
  | [term: string, kind: 'ipa', data: AceMetaIpaData];

/** `[name, category, order, notes, score]` */
export type AceTag = [name: string, category: string, order: number, notes: string, score: number];

/** `[character, onyomi, kunyomi, tags, meanings, stats]` */
export type AceKanji = [
  character: string,
  onyomi: string,
  kunyomi: string,
  tags: string,
  meanings: string[],
  stats: Record<string, string>,
];

/** `[character, 'freq', data]` */
export type AceKanjiMeta = [character: string, kind: 'freq', data: AceFrequencyValue];

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface AceCounts {
  entries: number;
  keys: number;
  meta: number;
  tags: number;
  kanji: number;
  kanjiMeta: number;
  assets: number;
}

export interface AceFiles {
  entries: string[];
  keys: string[];
  meta: string[];
  kanji: string[];
  kanjiMeta: string[];
  /** Asset paths relative to `assets/`. */
  assets: string[];
  styles?: string;
  tags?: string;
}

export interface AceSourceInfo {
  format: 'yomitan' | 'mdx' | 'custom' | (string & {});
  [key: string]: unknown;
}

export interface AceManifest {
  aceVersion: typeof ACE_FORMAT_VERSION;
  /** Stable identifier for the dictionary (independent of revision). */
  id: string;
  title: string;
  revision: string;
  author?: string;
  description?: string;
  attribution?: string;
  url?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  /** Union of all reading tags used in the dictionary (e.g. `["pinyin", "zhuyin"]`). */
  readingTags: string[];
  source: AceSourceInfo;
  generator: string;
  createdAt: string;
  sequenced?: boolean;
  frequencyMode?: 'occurrence-based' | 'rank-based';
  contentKinds: AceContentKind[];
  counts: AceCounts;
  files: AceFiles;
}

/** What a converter supplies; the writer fills in the rest. */
export type AceManifestInput = Omit<
  AceManifest,
  'aceVersion' | 'counts' | 'files' | 'contentKinds' | 'createdAt' | 'generator' | 'readingTags'
> & {
  generator?: string;
  createdAt?: string;
};
