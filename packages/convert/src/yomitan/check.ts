import { hash64 } from '@acetylcholine/ace';
import {
  BlobReader,
  type Entry,
  type FileEntry,
  TextWriter,
  Uint8ArrayReader,
  ZipReader,
} from '@zip.js/zip.js';
import type { ConvertSource } from '../types.ts';
import type { YomitanIndex, YomitanTermV3 } from './types.ts';

export interface YomitanEditionReport {
  title: string;
  revision: string;
  format: number;
  sequenced: boolean;
  rows: number;
  emptyTerms: number;
  distinctSequences: number;
  /** Sequences shared by more than one row (trad/simp forms, alias rows). */
  sharedSequences: number;
  rowsWithReadingTag: number;
  /** CSS selectors in styles.css that mention data-sc-reading-tag. */
  readingTagCssSelectors: string[];
}

export interface YomitanEditionsComparison {
  /** Same row count and, row by row, same term and sequence. */
  aligned: boolean;
  rowCountsMatch: boolean;
  /** Rows (by index) whose content differs between the first edition and this one. */
  contentDiffers: number;
  /** Rows whose term differs. */
  termDiffers: number;
  /** Rows whose sequence differs. */
  sequenceDiffers: number;
  /** Up to 5 example terms with differing content. */
  contentDiffExamples: string[];
}

export interface YomitanCheckResult {
  editions: YomitanEditionReport[];
  /** Comparison of editions[1..] against editions[0]. */
  comparisons: YomitanEditionsComparison[];
}

/**
 * Checks Yomitan zips against the conventions in docs/ACE_FORMAT.md: sequenced, no empty terms,
 * both reading systems inside content, and (for several editions) identical content row by row.
 */
export async function checkYomitanEditions(sources: ConvertSource[]): Promise<YomitanCheckResult> {
  const editions: YomitanEditionReport[] = [];
  const signatures: { terms: string[]; sequences: number[]; contents: string[] }[] = [];
  for (const source of sources) {
    const reader = source instanceof Blob ? new BlobReader(source) : new Uint8ArrayReader(source);
    const zip = new ZipReader(reader);
    try {
      const entries = (await zip.getEntries()).filter(isFileEntry);
      const indexEntry = entries.find((e) => e.filename === 'index.json');
      if (!indexEntry) throw new Error('index.json not found');
      const index = JSON.parse(await indexEntry.getData(new TextWriter())) as YomitanIndex;
      const banks = entries
        .map((e) => ({ e, m: /^term_bank_(\d+)\.json$/.exec(e.filename) }))
        .filter((x) => x.m)
        .sort((a, b) => Number(a.m![1]) - Number(b.m![1]));
      const terms: string[] = [];
      const sequences: number[] = [];
      const contents: string[] = [];
      let emptyTerms = 0;
      let rowsWithReadingTag = 0;
      const seqCounts = new Map<number, number>();
      for (const { e } of banks) {
        const rows = JSON.parse(await e.getData(new TextWriter())) as YomitanTermV3[];
        for (const row of rows) {
          const term = typeof row[0] === 'string' ? row[0] : '';
          if (term.trim().length === 0) emptyTerms++;
          const seq = typeof row[6] === 'number' ? row[6] : -1;
          seqCounts.set(seq, (seqCounts.get(seq) ?? 0) + 1);
          const json = JSON.stringify(row[5]);
          if (json.includes('"reading-tag"')) rowsWithReadingTag++;
          terms.push(term);
          sequences.push(seq);
          contents.push(hash64(json));
        }
      }
      const stylesEntry = entries.find((e) => e.filename === 'styles.css');
      const css = stylesEntry ? await stylesEntry.getData(new TextWriter()) : '';
      const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const readingTagCssSelectors = [
        ...cssNoComments.matchAll(/([^{};]*data-sc-reading-tag[^{}]*)\{/g),
      ].map((m) => m[1]!.trim());
      editions.push({
        title: index.title,
        revision: index.revision,
        format: index.format ?? index.version ?? 3,
        sequenced: index.sequenced === true,
        rows: terms.length,
        emptyTerms,
        distinctSequences: seqCounts.size,
        sharedSequences: [...seqCounts.values()].filter((c) => c > 1).length,
        rowsWithReadingTag,
        readingTagCssSelectors,
      });
      signatures.push({ terms, sequences, contents });
    } finally {
      await zip.close();
    }
  }

  const comparisons: YomitanEditionsComparison[] = [];
  const base = signatures[0];
  for (let i = 1; base && i < signatures.length; i++) {
    const other = signatures[i]!;
    const n = Math.min(base.terms.length, other.terms.length);
    let contentDiffers = 0;
    let termDiffers = 0;
    let sequenceDiffers = 0;
    const examples: string[] = [];
    for (let r = 0; r < n; r++) {
      if (base.terms[r] !== other.terms[r]) termDiffers++;
      if (base.sequences[r] !== other.sequences[r]) sequenceDiffers++;
      if (base.contents[r] !== other.contents[r]) {
        contentDiffers++;
        if (examples.length < 5) examples.push(base.terms[r]!);
      }
    }
    const rowCountsMatch = base.terms.length === other.terms.length;
    comparisons.push({
      aligned: rowCountsMatch && termDiffers === 0 && sequenceDiffers === 0,
      rowCountsMatch,
      contentDiffers,
      termDiffers,
      sequenceDiffers,
      contentDiffExamples: examples,
    });
  }
  return { editions, comparisons };
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}
