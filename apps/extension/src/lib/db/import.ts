/**
 * Streaming `.ace` import. One zip entry is read at a time; rows are written in bounded batches,
 * each in its own transaction, so memory use is independent of the dictionary size.
 */
import { AceReader } from '@acetylcholine/ace';
import { configure } from '@zip.js/zip.js';
import { deleteDictionaryData, findDictionary } from './dictionaries.ts';
import { mimeTypeFor } from './mime.ts';
import {
  type AceDatabase,
  type AssetRecord,
  type DictionaryRecord,
  type EntryRecord,
  getDatabase,
  type KanjiMetaRecord,
  type KanjiRecord,
  type KeyRecord,
  type MetaRecord,
  type TagRecord,
} from './schema.ts';

// Nested workers are blocked by the extension CSP; inflate on the current thread instead.
configure({ useWebWorkers: false });

export type ImportStage =
  | 'open'
  | 'entries'
  | 'keys'
  | 'meta'
  | 'tags'
  | 'kanji'
  | 'kanjiMeta'
  | 'assets'
  | 'finish';

export interface ImportProgress {
  stage: ImportStage;
  /** Units completed so far in this stage. */
  current: number;
  total: number;
  title: string;
}

export interface ImportOptions {
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  db?: AceDatabase;
  /** Rows per write transaction (keys and meta use four times as many). */
  batchSize?: number;
}

export class ImportAbortedError extends Error {
  override name = 'ImportAbortedError';
  constructor() {
    super('Import cancelled');
  }
}

type DataStore = 'entries' | 'keys' | 'meta' | 'tags' | 'kanji' | 'kanjiMeta' | 'assets';
type RowOf<S extends DataStore> = S extends 'entries'
  ? EntryRecord
  : S extends 'keys'
    ? KeyRecord
    : S extends 'meta'
      ? MetaRecord
      : S extends 'tags'
        ? TagRecord
        : S extends 'kanji'
          ? KanjiRecord
          : S extends 'kanjiMeta'
            ? KanjiMetaRecord
            : AssetRecord;

/** Collects rows and flushes them to a store in batches, reporting progress after each flush. */
class BatchWriter<S extends DataStore> {
  private rows: RowOf<S>[] = [];
  private written = 0;

  constructor(
    private readonly db: AceDatabase,
    private readonly store: S,
    private readonly limit: number,
    private readonly report: (written: number) => void,
    private readonly checkAborted: () => void,
  ) {}

  async push(row: RowOf<S>): Promise<void> {
    this.rows.push(row);
    if (this.rows.length >= this.limit) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.rows.length === 0) return;
    this.checkAborted();
    const tx = this.db.transaction(this.store, 'readwrite');
    const os = tx.objectStore(this.store);
    for (const row of this.rows) void os.put(row as never);
    await tx.done;
    this.written += this.rows.length;
    this.rows = [];
    this.report(this.written);
  }
}

export async function importAce(
  file: Blob,
  options: ImportOptions = {},
): Promise<DictionaryRecord> {
  const db = options.db ?? (await getDatabase());
  const batchSize = options.batchSize ?? 4096;
  const progress = options.onProgress ?? (() => {});
  const signal = options.signal;
  const checkAborted = () => {
    if (signal?.aborted) throw new ImportAbortedError();
  };

  progress({ stage: 'open', current: 0, total: 1, title: '' });
  const reader = await AceReader.open(file);
  const manifest = reader.manifest;
  const title = manifest.title;
  const stage = (s: ImportStage, total: number) => {
    progress({ stage: s, current: 0, total, title });
    return (current: number) => progress({ stage: s, current, total, title });
  };
  let record: DictionaryRecord | null = null;
  try {
    checkAborted();
    // Re-import replaces the previous copy (same manifest id).
    const existing = await findDictionary(manifest.id, db);
    if (existing) {
      await deleteDictionaryData(existing.n, db);
      await db.delete('dictionaries', existing.id);
    }
    const n = await allocateNumber(db);
    record = {
      id: manifest.id,
      n,
      manifest,
      styles: null,
      importedAt: Date.now(),
      fileSize: file.size,
      status: 'importing',
    };
    await db.put('dictionaries', record);

    const entries = new BatchWriter(
      db,
      'entries',
      batchSize,
      stage('entries', manifest.counts.entries),
      checkAborted,
    );
    for (const chunk of manifest.files.entries) {
      for await (const entry of reader.entriesOf(chunk)) await entries.push({ d: n, ...entry });
    }
    await entries.flush();

    const keys = new BatchWriter(
      db,
      'keys',
      batchSize * 4,
      stage('keys', manifest.counts.keys),
      checkAborted,
    );
    let keyNo = 0;
    for (const chunk of manifest.files.keys) {
      for await (const [key, entry, kind] of reader.keysOf(chunk)) {
        await keys.push({ d: n, n: keyNo++, key, entry, kind });
      }
    }
    await keys.flush();

    if (manifest.counts.meta > 0) {
      const meta = new BatchWriter(
        db,
        'meta',
        batchSize * 4,
        stage('meta', manifest.counts.meta),
        checkAborted,
      );
      let no = 0;
      for await (const [term, kind, data] of reader.meta()) {
        await meta.push({ d: n, n: no++, term, kind, data });
      }
      await meta.flush();
    }

    const tagRows = await reader.tags();
    if (tagRows.length > 0) {
      const tags = new BatchWriter(
        db,
        'tags',
        batchSize * 4,
        stage('tags', tagRows.length),
        checkAborted,
      );
      for (const [name, category, order, notes, score] of tagRows) {
        await tags.push({ d: n, name, category, order, notes, score });
      }
      await tags.flush();
    }

    if (manifest.counts.kanji > 0) {
      const kanji = new BatchWriter(
        db,
        'kanji',
        batchSize,
        stage('kanji', manifest.counts.kanji),
        checkAborted,
      );
      let no = 0;
      for await (const row of reader.kanji()) {
        await kanji.push({ d: n, n: no++, character: row[0], row });
      }
      await kanji.flush();
    }

    if (manifest.counts.kanjiMeta > 0) {
      const kanjiMeta = new BatchWriter(
        db,
        'kanjiMeta',
        batchSize * 4,
        stage('kanjiMeta', manifest.counts.kanjiMeta),
        checkAborted,
      );
      let no = 0;
      for await (const [character, , data] of reader.kanjiMeta()) {
        await kanjiMeta.push({ d: n, n: no++, character, data });
      }
      await kanjiMeta.flush();
    }

    const assetPaths = reader.assetPaths();
    if (assetPaths.length > 0) {
      const assets = new BatchWriter(
        db,
        'assets',
        64,
        stage('assets', assetPaths.length),
        checkAborted,
      );
      let pending = 0;
      for (const path of assetPaths) {
        const bytes = await reader.readAsset(path);
        if (!bytes) continue;
        const blob = new Blob([bytes as BlobPart], { type: mimeTypeFor(path) });
        await assets.push({ d: n, path, blob });
        pending += bytes.byteLength;
        if (pending >= 8 * 1024 * 1024) {
          await assets.flush();
          pending = 0;
        }
      }
      await assets.flush();
    }

    const finish = stage('finish', 1);
    record.styles = await reader.styles();
    record.status = 'ready';
    record.importedAt = Date.now();
    await db.put('dictionaries', record);
    finish(1);
    return record;
  } catch (err) {
    if (record) {
      try {
        await deleteDictionaryData(record.n, db);
        await db.delete('dictionaries', record.id);
      } catch {
        // best effort cleanup
      }
    }
    throw err;
  } finally {
    await reader.close();
  }
}

async function allocateNumber(db: AceDatabase): Promise<number> {
  const all = await db.getAll('dictionaries');
  let max = 0;
  for (const rec of all) if (rec.n > max) max = rec.n;
  return max + 1;
}
