import {
  type AceContent,
  type AceKanji,
  type AceKanjiMeta,
  AceKeyKind,
  type AceManifest,
  type AceMeta,
  type AceReading,
  type AceTag,
  type AceWriter,
  hash64,
  makeDictionaryId,
  type StructuredContent,
} from '@acetylcholine/ace';
import {
  BlobReader,
  type Entry,
  type FileEntry,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import { stripReadingTagRules } from '../css.ts';
import { detectReadingSystem } from '../reading-system.ts';
import type { ConvertProgress, ConvertSource } from '../types.ts';
import type {
  YomitanGlossaryItem,
  YomitanIndex,
  YomitanKanjiMeta,
  YomitanKanjiV1,
  YomitanKanjiV3,
  YomitanTag,
  YomitanTermMeta,
  YomitanTermV1,
  YomitanTermV3,
} from './types.ts';

export interface YomitanConvertOptions {
  /** Also index readings as lookup keys (kind = reading). Default: false. */
  indexReadings?: boolean;
  /**
   * Merge rows that describe the same entry. Default: true.
   *
   * - In a *sequenced* dictionary (`index.json` has `sequenced: true`) rows with the same sequence
   *   number and identical content merge: their terms become the entry's headwords and their
   *   readings are unioned. This is how traditional/simplified rows and the pinyin/zhuyin
   *   editions of one dictionary fold into a single entry.
   * - Otherwise rows with the same headword set and identical content merge (readings unioned).
   */
  merge?: boolean;
  /**
   * Opt-in: values of structured-content `data` attributes whose text marks another display form
   * of the headword. Only needed for unsequenced dictionaries that embed variant forms in content.
   * Default: none.
   */
  variantDataValues?: string[];
  /** Reading tag per input source (e.g. `['pinyin', 'zhuyin']`); auto-detected when omitted. */
  readingTags?: (string | undefined)[];
  /** Override the dictionary title (default: first source's title, minus a reading-system suffix when merging). */
  title?: string;
  /** Override the dictionary id. */
  id?: string;
  generator?: string;
  onProgress?: (progress: ConvertProgress) => void;
  /** Called for recoverable problems (e.g. rows skipped because the term is empty). */
  onWarning?: (message: string) => void;
}

export class YomitanFormatError extends Error {
  override name = 'YomitanFormatError';
}

const BANK_RE = /^(term_bank|term_meta_bank|tag_bank|kanji_bank|kanji_meta_bank)_(\d+)\.json$/;

type BankKind = 'term_bank' | 'term_meta_bank' | 'tag_bank' | 'kanji_bank' | 'kanji_meta_bank';

interface BankFile {
  kind: BankKind;
  index: number;
  entry: FileEntry;
}

interface OpenedSource {
  index: number;
  zip: ZipReader<unknown>;
  meta: YomitanIndex;
  format: 1 | 2 | 3;
  sequenced: boolean;
  banks: Record<BankKind, BankFile[]>;
  assets: FileEntry[];
  styles: FileEntry | null;
  readingTag: string | null;
  readingSamples: string[];
  termRows: number;
  skippedRows: number;
  recoveredRows: number;
}

interface MergeRecord {
  id: number;
  headwords: string[];
  readings: { text: string; sources: Set<number> }[];
  keys: string[];
}

export interface YomitanConvertResult {
  manifest: AceManifest;
  /** The finished archive when the writer had no sink; otherwise null. */
  blob: Blob | null;
}

/**
 * Converts one or more Yomitan/Yomichan dictionary zips into a single `.ace` file through the
 * given writer. Several sources are typically different reading editions of the same dictionary.
 * Returns the manifest that was written (and the blob when the writer collects in memory).
 */
export async function convertYomitan(
  sources: ConvertSource | ConvertSource[],
  writer: AceWriter,
  options: YomitanConvertOptions = {},
): Promise<YomitanConvertResult> {
  const list = Array.isArray(sources) ? sources : [sources];
  if (list.length === 0) throw new YomitanFormatError('No input sources given');
  const indexReadings = options.indexReadings ?? false;
  const merge = options.merge ?? true;
  const variantValues = new Set(options.variantDataValues ?? []);
  const progress = options.onProgress ?? (() => {});
  const warn = options.onWarning ?? (() => {});

  const opened: OpenedSource[] = [];
  try {
    for (let i = 0; i < list.length; i++) {
      progress({ stage: 'index', source: i, current: i, total: list.length });
      opened.push(await openSource(list[i]!, i));
    }

    // ---- pass 1: signatures, headword + reading union, reading-system detection ------------
    const table = new Map<string, MergeRecord>();
    const rowSigs: string[][] = [];
    for (const src of opened) {
      const banks = src.banks.term_bank;
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'terms',
          pass: 1,
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        const rows = await readRows(bank);
        const sigs: string[] = new Array(rows.length);
        for (let r = 0; r < rows.length; r++) {
          const row = normalizeTermRow(rows[r], src.format, bank.entry.filename);
          const content = convertGlossary(row[5] ?? []);
          const headwords = headwordsOf(row[0], content, variantValues);
          if (headwords.length === 0) {
            src.skippedRows++;
            if (src.skippedRows <= 5) {
              warn(
                `${bank.entry.filename} row ${r}: empty term and no headword in content, skipped`,
              );
            }
            continue;
          }
          if (row[0].trim().length === 0) src.recoveredRows++;
          const reading = row[1];
          if (reading && src.readingSamples.length < 4000) src.readingSamples.push(reading);
          if (!merge) continue;
          const sig = signatureOf(src.sequenced, row[6], headwords, content);
          sigs[r] = sig;
          let rec = table.get(sig);
          if (!rec) {
            rec = { id: -1, headwords: [], readings: [], keys: [] };
            table.set(sig, rec);
          }
          for (const hw of headwords) if (!rec.headwords.includes(hw)) rec.headwords.push(hw);
          if (reading) {
            const text = reading.normalize('NFC').trim();
            const existing = rec.readings.find((x) => x.text === text);
            if (existing) existing.sources.add(src.index);
            else rec.readings.push({ text, sources: new Set([src.index]) });
          }
        }
        rowSigs.push(sigs);
      }
      src.readingTag =
        options.readingTags?.[src.index] ?? detectReadingSystem(src.meta.title, src.readingSamples);
    }

    // ---- pass 2: write entries and keys ------------------------------------------------------
    let bankCursor = 0;
    for (const src of opened) {
      const banks = src.banks.term_bank;
      const tagList = src.readingTag ? [src.readingTag] : [];
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'terms',
          pass: 2,
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        const rows = await readRows(bank);
        const sigs = rowSigs[bankCursor++]!;
        for (let r = 0; r < rows.length; r++) {
          const row = normalizeTermRow(rows[r], src.format, bank.entry.filename);
          const [, readingRaw, defTags, rules, score, glossary, sequence, termTags] = row;
          const content = convertGlossary(glossary ?? []);
          const headwords = headwordsOf(row[0], content, variantValues);
          if (headwords.length === 0) continue;
          const term = headwords[0]!;
          const reading = readingRaw ? readingRaw.normalize('NFC').trim() : '';

          const rec = merge ? table.get(sigs[r]!) : undefined;
          let entryId: number;
          if (rec && rec.id >= 0) {
            entryId = rec.id;
          } else {
            const readings: AceReading[] = rec
              ? rec.readings.map((x) => ({
                  text: x.text,
                  tags: [...x.sources]
                    .map((i) => opened[i]!.readingTag)
                    .filter((t): t is string => t !== null),
                }))
              : reading
                ? [{ text: reading, tags: tagList }]
                : [];
            entryId = await writer.addEntry({
              headwords: rec ? rec.headwords : headwords,
              readings,
              content,
              tags: splitTags(defTags),
              termTags: splitTags(termTags),
              rules: splitTags(rules),
              score: typeof score === 'number' ? score : 0,
              sequence: typeof sequence === 'number' ? sequence : -1,
            });
            if (rec) rec.id = entryId;
          }

          const keys: [string, AceKeyKind][] = [[term, AceKeyKind.Headword]];
          for (const v of headwords.slice(1)) keys.push([v, AceKeyKind.Variant]);
          if (indexReadings) {
            const readingTexts = rec ? rec.readings.map((x) => x.text) : reading ? [reading] : [];
            for (const t of readingTexts) if (t !== term) keys.push([t, AceKeyKind.Reading]);
          }
          for (const [key, kind] of keys) {
            const normalized = key.normalize('NFC').trim();
            if (normalized.length === 0) continue;
            if (rec) {
              if (rec.keys.includes(normalized)) continue;
              rec.keys.push(normalized);
            }
            await writer.addKey(normalized, entryId, kind);
          }
          src.termRows++;
        }
      }
    }
    table.clear();
    rowSigs.length = 0;
    for (const src of opened) {
      if (src.recoveredRows > 0) {
        warn(
          `${src.meta.title}: ${src.recoveredRows} row(s) had an empty term; headword recovered from content`,
        );
      }
      if (src.skippedRows > 0) {
        warn(`${src.meta.title}: skipped ${src.skippedRows} row(s) with an empty term`);
      }
    }

    // ---- meta / tags / kanji (de-duplicated across sources) ----------------------------------
    const seen = new Set<string>();
    const unique = (row: unknown): boolean => {
      const h = hash64(JSON.stringify(row));
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    };
    for (const src of opened) {
      const banks = src.banks.term_meta_bank;
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'meta',
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        for (const row of (await readRows(bank)) as YomitanTermMeta[]) {
          if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string') {
            throw new YomitanFormatError(`Malformed term meta row in ${bank.entry.filename}`);
          }
          if (unique(row)) await writer.addMeta(row as AceMeta);
        }
      }
    }
    seen.clear();
    for (const src of opened) {
      const banks = src.banks.tag_bank;
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'tags',
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        for (const row of (await readRows(bank)) as YomitanTag[]) {
          if (!Array.isArray(row) || row.length !== 5) {
            throw new YomitanFormatError(`Malformed tag row in ${bank.entry.filename}`);
          }
          if (unique(row)) writer.addTag(row as AceTag);
        }
      }
      if (src.meta.tagMeta && banks.length === 0) {
        for (const [name, meta] of Object.entries(src.meta.tagMeta)) {
          const row: AceTag = [
            name,
            meta.category ?? '',
            meta.order ?? 0,
            meta.notes ?? '',
            meta.score ?? 0,
          ];
          if (unique(row)) writer.addTag(row);
        }
      }
    }
    seen.clear();
    for (const src of opened) {
      const banks = src.banks.kanji_bank;
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'kanji',
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        for (const raw of await readRows(bank)) {
          const row =
            src.format === 1 ? upgradeKanjiV1(raw as YomitanKanjiV1) : (raw as YomitanKanjiV3);
          if (!Array.isArray(row) || row.length !== 6) {
            throw new YomitanFormatError(`Malformed kanji row in ${bank.entry.filename}`);
          }
          if (unique(row)) await writer.addKanji(row as AceKanji);
        }
      }
    }
    seen.clear();
    for (const src of opened) {
      const banks = src.banks.kanji_meta_bank;
      for (let b = 0; b < banks.length; b++) {
        const bank = banks[b]!;
        progress({
          stage: 'kanjiMeta',
          source: src.index,
          file: bank.entry.filename,
          current: b,
          total: banks.length,
        });
        for (const row of (await readRows(bank)) as YomitanKanjiMeta[]) {
          if (!Array.isArray(row) || row.length !== 3) {
            throw new YomitanFormatError(`Malformed kanji meta row in ${bank.entry.filename}`);
          }
          if (unique(row)) await writer.addKanjiMeta(row as AceKanjiMeta);
        }
      }
    }
    seen.clear();

    // ---- styles + assets ---------------------------------------------------------------------
    const cssSeen = new Set<string>();
    for (const src of opened) {
      if (!src.styles) continue;
      const css = stripReadingTagRules(await src.styles.getData(new TextWriter())).trim();
      if (css.length === 0) continue;
      const h = hash64(css);
      if (cssSeen.has(h)) continue;
      cssSeen.add(h);
      writer.appendStyles(css);
    }
    for (const src of opened) {
      for (let a = 0; a < src.assets.length; a++) {
        const entry = src.assets[a]!;
        if (writer.hasAsset(entry.filename)) continue;
        progress({
          stage: 'assets',
          source: src.index,
          file: entry.filename,
          current: a,
          total: src.assets.length,
        });
        await writer.addAsset(entry.filename, await entry.getData(new Uint8ArrayWriter()));
      }
    }

    // ---- manifest ----------------------------------------------------------------------------
    progress({ stage: 'finish', current: 0, total: 1 });
    const first = opened[0]!.meta;
    const distinctTags = new Set(opened.map((s) => s.readingTag).filter((t) => t !== null));
    const title =
      options.title ??
      (opened.length > 1 && distinctTags.size > 1
        ? stripReadingSystemSuffix(first.title)
        : first.title);
    return await writer.finish({
      id: options.id ?? makeDictionaryId('yomitan', title),
      title,
      revision: first.revision,
      author: first.author,
      description: first.description,
      attribution: first.attribution,
      url: first.url,
      sourceLanguage: first.sourceLanguage,
      targetLanguage: first.targetLanguage,
      sequenced: opened.some((s) => s.sequenced),
      frequencyMode: first.frequencyMode,
      source: {
        format: 'yomitan',
        formatVersion: opened[0]!.format,
        sources: opened.map((s) => ({
          title: s.meta.title,
          revision: s.meta.revision,
          sequenced: s.sequenced,
          readingTag: s.readingTag,
          termRows: s.termRows,
          skippedRows: s.skippedRows,
          recoveredRows: s.recoveredRows,
          indexUrl: s.meta.indexUrl,
          downloadUrl: s.meta.downloadUrl,
        })),
      },
      generator: options.generator,
    });
  } finally {
    for (const src of opened) await src.zip.close();
  }
}

// ---------------------------------------------------------------------------

async function openSource(source: ConvertSource, index: number): Promise<OpenedSource> {
  const reader = source instanceof Blob ? new BlobReader(source) : new Uint8ArrayReader(source);
  const zip = new ZipReader(reader);
  let entries: FileEntry[];
  try {
    entries = (await zip.getEntries()).filter(isFileEntry);
  } catch (err) {
    throw new YomitanFormatError(
      `Input ${index + 1} is not a valid zip: ${(err as Error).message}`,
    );
  }
  const indexEntry = entries.find((e) => e.filename === 'index.json');
  if (!indexEntry) throw new YomitanFormatError(`index.json not found in input ${index + 1}`);
  const meta = JSON.parse(await indexEntry.getData(new TextWriter())) as YomitanIndex;
  if (typeof meta.title !== 'string' || typeof meta.revision !== 'string') {
    throw new YomitanFormatError('index.json must contain "title" and "revision"');
  }
  const format = meta.format ?? meta.version ?? 3;
  if (format !== 1 && format !== 2 && format !== 3) {
    throw new YomitanFormatError(`Unsupported dictionary format ${String(format)}`);
  }
  const banks: Record<BankKind, BankFile[]> = {
    term_bank: [],
    term_meta_bank: [],
    tag_bank: [],
    kanji_bank: [],
    kanji_meta_bank: [],
  };
  const assets: FileEntry[] = [];
  let styles: FileEntry | null = null;
  for (const entry of entries) {
    const m = BANK_RE.exec(entry.filename);
    if (m) banks[m[1] as BankKind].push({ kind: m[1] as BankKind, index: Number(m[2]), entry });
    else if (entry.filename === 'index.json') continue;
    else if (entry.filename === 'styles.css') styles = entry;
    else assets.push(entry);
  }
  for (const kind of Object.keys(banks) as BankKind[])
    banks[kind].sort((a, b) => a.index - b.index);
  return {
    index,
    zip,
    meta,
    format,
    sequenced: meta.sequenced === true,
    banks,
    assets,
    styles,
    readingTag: null,
    readingSamples: [],
    termRows: 0,
    skippedRows: 0,
    recoveredRows: 0,
  };
}

async function readRows(bank: BankFile): Promise<unknown[]> {
  const rows = JSON.parse(await bank.entry.getData(new TextWriter())) as unknown;
  if (!Array.isArray(rows)) {
    throw new YomitanFormatError(`${bank.entry.filename} is not a JSON array`);
  }
  return rows;
}

function normalizeTermRow(raw: unknown, format: 1 | 2 | 3, file: string): YomitanTermV3 {
  if (!Array.isArray(raw) || raw.length < 5 || typeof raw[0] !== 'string') {
    throw new YomitanFormatError(`Malformed term row in ${file}`);
  }
  if (format === 1) return upgradeTermV1(raw as YomitanTermV1);
  const row = raw as YomitanTermV3;
  if (!Array.isArray(row[5])) throw new YomitanFormatError(`Malformed glossary in ${file}`);
  return row;
}

/**
 * Canonical headword plus any opt-in variants found in the content. When the row's term is empty
 * (a quirk seen in real dictionaries) the first marked variant in the content becomes the headword.
 */
function headwordsOf(term: string, content: AceContent[], markers: ReadonlySet<string>): string[] {
  const t = term.normalize('NFC').trim();
  const out = t.length > 0 ? [t] : [];
  for (const v of collectVariants(content, t, markers)) if (!out.includes(v)) out.push(v);
  return out;
}

/**
 * Merge signature of a row. Sequenced dictionaries group by sequence number + content (so rows
 * with different terms can be the same entry); others group by headword set + content.
 */
function signatureOf(
  sequenced: boolean,
  sequence: unknown,
  headwords: string[],
  content: AceContent[],
): string {
  const body = JSON.stringify(content);
  if (sequenced && typeof sequence === 'number' && sequence >= 0) {
    return hash64(`S${sequence} ${body}`);
  }
  return hash64(`H${[...headwords].sort().join('')} ${body}`);
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}

function splitTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(/\s+/).filter((s) => s.length > 0);
}

function upgradeTermV1(row: YomitanTermV1): YomitanTermV3 {
  const [term, reading, tags, rules, score, ...glossary] = row;
  return [term, reading, tags, rules, score, glossary, -1, ''];
}

function upgradeKanjiV1(row: YomitanKanjiV1): YomitanKanjiV3 {
  const [character, onyomi, kunyomi, tags, ...meanings] = row;
  return [character, onyomi, kunyomi, tags, meanings, {}];
}

/** Removes a trailing reading-system word from a title ("现代汉语规范词典 拼音" → "现代汉语规范词典"). */
export function stripReadingSystemSuffix(title: string): string {
  return (
    title.replace(/[\s\-_(（[]*(拼音|注音|pinyin|zhuyin|bopomofo)[)）\]]*\s*$/i, '').trim() || title
  );
}

export function convertGlossary(glossary: YomitanGlossaryItem[]): AceContent[] {
  const out: AceContent[] = [];
  for (const item of glossary) {
    if (typeof item === 'string') {
      out.push({ type: 'text', text: item });
    } else if (Array.isArray(item)) {
      out.push({ type: 'deinflection', term: item[0], rules: item[1] ?? [] });
    } else if (item && typeof item === 'object') {
      switch (item.type) {
        case 'text':
          out.push({ type: 'text', text: item.text });
          break;
        case 'structured-content':
          out.push({ type: 'structured', content: item.content as StructuredContent });
          break;
        case 'image': {
          const { type: _type, ...rest } = item;
          out.push({ type: 'image', ...(rest as { path: string }) });
          break;
        }
        default:
          throw new YomitanFormatError(
            `Unknown glossary item type ${String((item as { type: unknown }).type)}`,
          );
      }
    } else {
      throw new YomitanFormatError('Malformed glossary item');
    }
  }
  return out;
}

/**
 * Finds alternate display forms of the headword inside structured content: nodes whose `data`
 * carries one of the marker values and whose text differs from the term.
 */
export function collectVariants(
  content: AceContent[],
  term: string,
  markers: ReadonlySet<string>,
): string[] {
  if (markers.size === 0) return [];
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string' || node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== 'object') return;
    const n = node as { data?: Record<string, string>; content?: unknown };
    if (n.data) {
      for (const value of Object.values(n.data)) {
        if (markers.has(value)) {
          const text = plainText(n.content).normalize('NFC').trim();
          if (isPlausibleVariant(text, term) && !found.includes(text)) found.push(text);
          break;
        }
      }
    }
    if (n.content !== undefined) visit(n.content);
  };
  for (const block of content) {
    if (block.type === 'structured') visit(block.content);
  }
  return found;
}

function plainText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (node && typeof node === 'object') {
    const n = node as { tag?: string; content?: unknown };
    if (n.tag === 'img' || n.tag === 'br') return ' ';
    return plainText(n.content);
  }
  return '';
}

function isPlausibleVariant(text: string, term: string): boolean {
  if (text.length === 0 || text === term) return false;
  if (text.includes(' ') || /\s/.test(text)) return false;
  const a = [...text].length;
  if (a > 64) return false;
  if (term.length === 0) return true;
  const b = [...term].length;
  return Math.abs(a - b) <= 2;
}
