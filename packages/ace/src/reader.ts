import {
  BlobReader,
  type Entry,
  type FileEntry,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from '@zip.js/zip.js';
import { readJsonLines } from './jsonl.ts';
import { aceManifestSchema } from './schema.ts';
import type {
  AceEntry,
  AceKanji,
  AceKanjiMeta,
  AceKey,
  AceManifest,
  AceMeta,
  AceTag,
} from './types.ts';
import { ACE_FORMAT_VERSION } from './types.ts';
import { normalizeAssetPath } from './writer.ts';

export type AceSource = Blob | Uint8Array;

export class AceFormatError extends Error {
  override name = 'AceFormatError';
}

/**
 * Random-access reader for `.ace` files. Reads one zip entry at a time, so memory use is bounded
 * by the largest chunk, not by the dictionary size.
 */
export class AceReader {
  readonly manifest: AceManifest;
  private readonly zip: ZipReader<unknown>;
  private readonly files: Map<string, FileEntry>;

  private constructor(
    zip: ZipReader<unknown>,
    files: Map<string, FileEntry>,
    manifest: AceManifest,
  ) {
    this.zip = zip;
    this.files = files;
    this.manifest = manifest;
  }

  static async open(source: AceSource): Promise<AceReader> {
    const reader = source instanceof Blob ? new BlobReader(source) : new Uint8ArrayReader(source);
    const zip = new ZipReader(reader);
    let list: Entry[];
    try {
      list = await zip.getEntries();
    } catch (err) {
      throw new AceFormatError(`Not a valid .ace (zip) file: ${(err as Error).message}`);
    }
    const files = new Map<string, FileEntry>();
    for (const e of list) if (isFileEntry(e)) files.set(e.filename, e);
    const manifestEntry = files.get('manifest.json');
    if (!manifestEntry) throw new AceFormatError('manifest.json is missing');
    const manifestText = await manifestEntry.getData(new TextWriter());
    let raw: unknown;
    try {
      raw = JSON.parse(manifestText);
    } catch (err) {
      throw new AceFormatError(`manifest.json is not valid JSON: ${(err as Error).message}`);
    }
    const version = (raw as { aceVersion?: unknown })?.aceVersion;
    if (typeof version !== 'number' || version > ACE_FORMAT_VERSION) {
      throw new AceFormatError(
        `Unsupported .ace version ${String(version)} (this reader supports ≤ ${ACE_FORMAT_VERSION})`,
      );
    }
    const parsed = aceManifestSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AceFormatError(`manifest.json is invalid: ${parsed.error.message}`);
    }
    return new AceReader(zip, files, parsed.data as AceManifest);
  }

  /** Names of all files inside the archive. */
  fileNames(): string[] {
    return [...this.files.keys()];
  }

  hasFile(name: string): boolean {
    return this.files.has(name);
  }

  async readText(name: string): Promise<string> {
    return this.requireEntry(name).getData(new TextWriter());
  }

  async readBytes(name: string): Promise<Uint8Array> {
    return this.requireEntry(name).getData(new Uint8ArrayWriter());
  }

  /** Streams the raw bytes of a file. */
  readStream(name: string): ReadableStream<Uint8Array> {
    const entry = this.requireEntry(name);
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    entry.getData(writable).catch((err: unknown) => {
      void readable.cancel(err);
    });
    return readable;
  }

  entryChunks(): readonly string[] {
    return this.manifest.files.entries;
  }

  async *entriesOf(chunk: string): AsyncGenerator<AceEntry> {
    yield* readJsonLines<AceEntry>(this.readStream(chunk));
  }

  async *entries(): AsyncGenerator<AceEntry> {
    for (const chunk of this.manifest.files.entries) yield* this.entriesOf(chunk);
  }

  async *keysOf(chunk: string): AsyncGenerator<AceKey> {
    yield* readJsonLines<AceKey>(this.readStream(chunk));
  }

  async *keys(): AsyncGenerator<AceKey> {
    for (const chunk of this.manifest.files.keys) yield* this.keysOf(chunk);
  }

  async *meta(): AsyncGenerator<AceMeta> {
    for (const chunk of this.manifest.files.meta) {
      yield* readJsonLines<AceMeta>(this.readStream(chunk));
    }
  }

  async *kanji(): AsyncGenerator<AceKanji> {
    for (const chunk of this.manifest.files.kanji) {
      yield* readJsonLines<AceKanji>(this.readStream(chunk));
    }
  }

  async *kanjiMeta(): AsyncGenerator<AceKanjiMeta> {
    for (const chunk of this.manifest.files.kanjiMeta) {
      yield* readJsonLines<AceKanjiMeta>(this.readStream(chunk));
    }
  }

  async tags(): Promise<AceTag[]> {
    const name = this.manifest.files.tags;
    if (!name) return [];
    return JSON.parse(await this.readText(name)) as AceTag[];
  }

  async styles(): Promise<string | null> {
    const name = this.manifest.files.styles;
    if (!name) return null;
    return this.readText(name);
  }

  assetPaths(): readonly string[] {
    return this.manifest.files.assets;
  }

  hasAsset(path: string): boolean {
    return this.files.has(`assets/${normalizeAssetPath(path)}`);
  }

  async readAsset(path: string): Promise<Uint8Array | null> {
    const entry = this.files.get(`assets/${normalizeAssetPath(path)}`);
    if (!entry) return null;
    return entry.getData(new Uint8ArrayWriter());
  }

  /** Looks up entries whose key equals `term` by scanning key chunks (dev/CLI use, not fast). */
  async findEntries(term: string): Promise<{ entry: AceEntry; kinds: number[] }[]> {
    const needle = term.normalize('NFC').trim();
    const hits = new Map<number, number[]>();
    for await (const [key, id, kind] of this.keys()) {
      if (key === needle) {
        const kinds = hits.get(id) ?? [];
        kinds.push(kind);
        hits.set(id, kinds);
      }
    }
    if (hits.size === 0) return [];
    const out: { entry: AceEntry; kinds: number[] }[] = [];
    for await (const entry of this.entries()) {
      const kinds = hits.get(entry.id);
      if (kinds) out.push({ entry, kinds });
      if (out.length === hits.size) break;
    }
    return out;
  }

  async close(): Promise<void> {
    await this.zip.close();
  }

  private requireEntry(name: string): FileEntry {
    const entry = this.files.get(name);
    if (!entry) throw new AceFormatError(`File not found in archive: ${name}`);
    return entry;
  }
}

function isFileEntry(entry: Entry): entry is FileEntry {
  return !entry.directory;
}
