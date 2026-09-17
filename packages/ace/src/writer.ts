import { BlobReader, BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js';
import { toJsonl } from './jsonl.ts';
import type {
  AceContentKind,
  AceEntry,
  AceKanji,
  AceKanjiMeta,
  AceKey,
  AceKeyKind,
  AceManifest,
  AceManifestInput,
  AceMeta,
  AceReading,
  AceTag,
} from './types.ts';
import { ACE_FORMAT_VERSION } from './types.ts';
import { chunkName, normalizeKey } from './util.ts';

export interface AceWriterOptions {
  /** Where the zip bytes go. When omitted, the zip is collected into a Blob returned by `finish()`. */
  sink?: WritableStream<Uint8Array>;
  /** Deflate level 0-9 for text chunks (default 6). Already-compressed assets are stored. */
  compressionLevel?: number;
  entriesPerChunk?: number;
  keysPerChunk?: number;
  metaPerChunk?: number;
  kanjiPerChunk?: number;
  /** Text describing the producing tool, recorded in the manifest. */
  generator?: string;
}

export type AceEntryInput = Omit<AceEntry, 'id'> & { id?: number };

const ALREADY_COMPRESSED = /\.(png|jpe?g|gif|webp|avif|woff2?|mp3|ogg|opus|m4a|aac|zip|br|gz)$/i;

/**
 * Streaming writer for `.ace` files.
 *
 * Records are buffered per kind and flushed into numbered JSONL chunks inside the zip.
 * All methods must be awaited in order (the writer serializes zip additions internally).
 */
export class AceWriter {
  private readonly zip: ZipWriter<unknown>;
  private readonly blobWriter: BlobWriter | null;
  private readonly level: number;
  private readonly generator: string;

  private readonly limits: { entries: number; keys: number; meta: number; kanji: number };

  private entryBuffer: AceEntry[] = [];
  private keyBuffer: AceKey[] = [];
  private metaBuffer: AceMeta[] = [];
  private kanjiBuffer: AceKanji[] = [];
  private kanjiMetaBuffer: AceKanjiMeta[] = [];
  private tags: AceTag[] = [];
  private styles: string | null = null;

  private files = {
    entries: [] as string[],
    keys: [] as string[],
    meta: [] as string[],
    kanji: [] as string[],
    kanjiMeta: [] as string[],
    assets: [] as string[],
  };
  private counts = { entries: 0, keys: 0, meta: 0, tags: 0, kanji: 0, kanjiMeta: 0, assets: 0 };
  private contentKinds = new Set<AceContentKind>();
  private readingTags = new Set<string>();
  private nextId = 0;
  private assetPaths = new Set<string>();
  private finished = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: AceWriterOptions = {}) {
    this.level = options.compressionLevel ?? 6;
    this.generator = options.generator ?? 'acetylcholine-ace/0.1.0';
    this.limits = {
      entries: options.entriesPerChunk ?? 4096,
      keys: options.keysPerChunk ?? 65536,
      meta: options.metaPerChunk ?? 65536,
      kanji: options.kanjiPerChunk ?? 16384,
    };
    if (options.sink) {
      this.blobWriter = null;
      this.zip = new ZipWriter(options.sink, { level: this.level });
    } else {
      this.blobWriter = new BlobWriter('application/zip');
      this.zip = new ZipWriter(this.blobWriter, { level: this.level });
    }
  }

  /** The id the next `addEntry()` call will receive when no explicit id is given. */
  peekNextId(): number {
    return this.nextId;
  }

  async addEntry(input: AceEntryInput): Promise<number> {
    this.assertOpen();
    const id = input.id ?? this.nextId;
    if (id < this.nextId) {
      throw new Error(`Entry ids must be ascending (got ${id}, expected ≥ ${this.nextId})`);
    }
    this.nextId = id + 1;
    const headwords: string[] = [];
    for (const h of input.headwords) {
      const text = h.normalize('NFC');
      if (text.length > 0 && !headwords.includes(text)) headwords.push(text);
    }
    if (headwords.length === 0) throw new Error(`Entry ${id} has no headword`);

    const readings: AceReading[] = [];
    for (const r of input.readings) {
      const text = r.text.normalize('NFC').trim();
      if (text.length === 0) continue;
      const existing = readings.find((x) => x.text === text);
      if (existing) {
        for (const t of r.tags) if (!existing.tags.includes(t)) existing.tags.push(t);
        continue;
      }
      readings.push({ text, tags: [...new Set(r.tags)] });
    }
    for (const r of readings) for (const t of r.tags) this.readingTags.add(t);

    const entry: AceEntry = {
      id,
      headwords,
      readings,
      content: input.content,
      tags: input.tags,
      termTags: input.termTags,
      rules: input.rules,
      score: input.score,
      sequence: input.sequence,
    };
    for (const c of entry.content) this.contentKinds.add(c.type);
    this.entryBuffer.push(entry);
    this.counts.entries++;
    if (this.entryBuffer.length >= this.limits.entries) await this.flushEntries();
    return id;
  }

  async addKey(key: string, entryId: number, kind: AceKeyKind): Promise<void> {
    this.assertOpen();
    const normalized = normalizeKey(key);
    if (normalized.length === 0) return;
    this.keyBuffer.push([normalized, entryId, kind]);
    this.counts.keys++;
    if (this.keyBuffer.length >= this.limits.keys) await this.flushKeys();
  }

  async addMeta(row: AceMeta): Promise<void> {
    this.assertOpen();
    this.metaBuffer.push(row);
    this.counts.meta++;
    if (this.metaBuffer.length >= this.limits.meta) await this.flushMeta();
  }

  async addKanji(row: AceKanji): Promise<void> {
    this.assertOpen();
    this.kanjiBuffer.push(row);
    this.counts.kanji++;
    if (this.kanjiBuffer.length >= this.limits.kanji) await this.flushKanji();
  }

  async addKanjiMeta(row: AceKanjiMeta): Promise<void> {
    this.assertOpen();
    this.kanjiMetaBuffer.push(row);
    this.counts.kanjiMeta++;
    if (this.kanjiMetaBuffer.length >= this.limits.kanji) await this.flushKanjiMeta();
  }

  addTag(row: AceTag): void {
    this.assertOpen();
    this.tags.push(row);
    this.counts.tags++;
  }

  setStyles(css: string): void {
    this.assertOpen();
    this.styles = css;
  }

  appendStyles(css: string): void {
    this.assertOpen();
    this.styles = this.styles ? `${this.styles}\n${css}` : css;
  }

  getStyles(): string | null {
    return this.styles;
  }

  hasAsset(path: string): boolean {
    return this.assetPaths.has(normalizeAssetPath(path));
  }

  /** Adds an asset under `assets/<path>`. Duplicate paths are ignored. */
  async addAsset(path: string, data: Uint8Array | Blob): Promise<void> {
    this.assertOpen();
    const normalized = normalizeAssetPath(path);
    if (normalized.length === 0) throw new Error('Asset path must not be empty');
    if (this.assetPaths.has(normalized)) return;
    this.assetPaths.add(normalized);
    this.files.assets.push(normalized);
    this.counts.assets++;
    const level = ALREADY_COMPRESSED.test(normalized) ? 0 : this.level;
    const reader = data instanceof Blob ? new BlobReader(data) : new Uint8ArrayReader(data);
    await this.enqueue(() => this.zip.add(`assets/${normalized}`, reader, { level }));
  }

  /** Flushes buffers, writes tags/styles/manifest, closes the zip. */
  async finish(input: AceManifestInput): Promise<{ manifest: AceManifest; blob: Blob | null }> {
    this.assertOpen();
    this.finished = true;
    await this.flushEntries();
    await this.flushKeys();
    await this.flushMeta();
    await this.flushKanji();
    await this.flushKanjiMeta();

    const files: AceManifest['files'] = { ...this.files };
    if (this.tags.length > 0) {
      files.tags = 'tags.json';
      await this.addText('tags.json', JSON.stringify(this.tags));
    }
    if (this.styles !== null && this.styles.trim().length > 0) {
      files.styles = 'styles.css';
      await this.addText('styles.css', this.styles);
    }

    const manifest: AceManifest = {
      aceVersion: ACE_FORMAT_VERSION,
      id: input.id,
      title: input.title,
      revision: input.revision,
      author: input.author,
      description: input.description,
      attribution: input.attribution,
      url: input.url,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      readingTags: [...this.readingTags],
      source: input.source,
      generator: input.generator ?? this.generator,
      createdAt: input.createdAt ?? new Date().toISOString(),
      sequenced: input.sequenced,
      frequencyMode: input.frequencyMode,
      contentKinds: [...this.contentKinds],
      counts: { ...this.counts },
      files,
    };
    for (const k of Object.keys(manifest) as (keyof AceManifest)[]) {
      if (manifest[k] === undefined) delete manifest[k];
    }
    await this.addText('manifest.json', JSON.stringify(manifest, null, 2));
    await this.queue;
    const result = await this.zip.close();
    const blob = this.blobWriter ? (result as Blob) : null;
    return { manifest, blob };
  }

  // -- internals -----------------------------------------------------------

  private assertOpen(): void {
    if (this.finished) throw new Error('AceWriter is already finished');
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private addText(name: string, text: string, level = this.level): Promise<unknown> {
    return this.enqueue(() => this.zip.add(name, new TextReader(text), { level }));
  }

  private async flushEntries(): Promise<void> {
    if (this.entryBuffer.length === 0) return;
    const name = chunkName('entries', this.files.entries.length + 1);
    this.files.entries.push(name);
    const text = toJsonl(this.entryBuffer);
    this.entryBuffer = [];
    await this.addText(name, text);
  }

  private async flushKeys(): Promise<void> {
    if (this.keyBuffer.length === 0) return;
    const name = chunkName('keys', this.files.keys.length + 1);
    this.files.keys.push(name);
    const text = toJsonl(this.keyBuffer);
    this.keyBuffer = [];
    await this.addText(name, text);
  }

  private async flushMeta(): Promise<void> {
    if (this.metaBuffer.length === 0) return;
    const name = chunkName('meta', this.files.meta.length + 1);
    this.files.meta.push(name);
    const text = toJsonl(this.metaBuffer);
    this.metaBuffer = [];
    await this.addText(name, text);
  }

  private async flushKanji(): Promise<void> {
    if (this.kanjiBuffer.length === 0) return;
    const name = chunkName('kanji', this.files.kanji.length + 1);
    this.files.kanji.push(name);
    const text = toJsonl(this.kanjiBuffer);
    this.kanjiBuffer = [];
    await this.addText(name, text);
  }

  private async flushKanjiMeta(): Promise<void> {
    if (this.kanjiMetaBuffer.length === 0) return;
    const name = chunkName('kanji-meta', this.files.kanjiMeta.length + 1);
    this.files.kanjiMeta.push(name);
    const text = toJsonl(this.kanjiMetaBuffer);
    this.kanjiMetaBuffer = [];
    await this.addText(name, text);
  }
}

/** Normalizes an asset path: forward slashes, no leading `./` or `/`, NFC. */
export function normalizeAssetPath(path: string): string {
  let p = path.normalize('NFC').replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  while (p.startsWith('/')) p = p.slice(1);
  return p;
}
