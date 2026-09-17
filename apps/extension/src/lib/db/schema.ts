/**
 * IndexedDB layout. Every data row carries the small integer `d` of its dictionary as the first
 * component of its primary key, so a whole dictionary can be deleted with one key-range delete
 * per store and rows never need a secondary "dictionary" index.
 */
import type {
  AceEntry,
  AceKanji,
  AceKeyKind,
  AceManifest,
  AceMetaFreqData,
} from '@acetylcholine/ace';
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

export const DB_NAME = 'acetylcholine';
export const DB_VERSION = 1;

export type DictionaryStatus = 'importing' | 'ready';

export interface DictionaryRecord {
  /** Manifest id (primary key). */
  id: string;
  /** Dictionary number used in every data row. Unique, never reused while the record exists. */
  n: number;
  manifest: AceManifest;
  styles: string | null;
  importedAt: number;
  fileSize: number;
  status: DictionaryStatus;
}

export interface EntryRecord extends AceEntry {
  d: number;
}

export interface KeyRecord {
  d: number;
  n: number;
  key: string;
  entry: number;
  kind: AceKeyKind;
}

export interface MetaRecord {
  d: number;
  n: number;
  term: string;
  kind: 'freq' | 'pitch' | 'ipa';
  data: unknown;
}

export interface TagRecord {
  d: number;
  name: string;
  category: string;
  order: number;
  notes: string;
  score: number;
}

export interface KanjiRecord {
  d: number;
  n: number;
  character: string;
  row: AceKanji;
}

export interface KanjiMetaRecord {
  d: number;
  n: number;
  character: string;
  data: AceMetaFreqData;
}

export interface AssetRecord {
  d: number;
  path: string;
  blob: Blob;
}

export interface AceDB extends DBSchema {
  dictionaries: { key: string; value: DictionaryRecord; indexes: { n: number } };
  entries: { key: [number, number]; value: EntryRecord };
  keys: { key: [number, number]; value: KeyRecord; indexes: { key: string } };
  meta: { key: [number, number]; value: MetaRecord; indexes: { term: string } };
  tags: { key: [number, string]; value: TagRecord };
  kanji: { key: [number, number]; value: KanjiRecord; indexes: { character: string } };
  kanjiMeta: { key: [number, number]; value: KanjiMetaRecord; indexes: { character: string } };
  assets: { key: [number, string]; value: AssetRecord };
}

export type AceDatabase = IDBPDatabase<AceDB>;

/** Stores whose rows belong to a dictionary (everything except `dictionaries`). */
export const DATA_STORES = [
  'entries',
  'keys',
  'meta',
  'tags',
  'kanji',
  'kanjiMeta',
  'assets',
] as const;
export type DataStore = (typeof DATA_STORES)[number];

export function openDatabase(): Promise<AceDatabase> {
  return openDB<AceDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const dictionaries = db.createObjectStore('dictionaries', { keyPath: 'id' });
        dictionaries.createIndex('n', 'n', { unique: true });
        db.createObjectStore('entries', { keyPath: ['d', 'id'] });
        const keys = db.createObjectStore('keys', { keyPath: ['d', 'n'] });
        keys.createIndex('key', 'key', { unique: false });
        const meta = db.createObjectStore('meta', { keyPath: ['d', 'n'] });
        meta.createIndex('term', 'term', { unique: false });
        db.createObjectStore('tags', { keyPath: ['d', 'name'] });
        const kanji = db.createObjectStore('kanji', { keyPath: ['d', 'n'] });
        kanji.createIndex('character', 'character', { unique: false });
        const kanjiMeta = db.createObjectStore('kanjiMeta', { keyPath: ['d', 'n'] });
        kanjiMeta.createIndex('character', 'character', { unique: false });
        db.createObjectStore('assets', { keyPath: ['d', 'path'] });
      }
    },
    blocking() {
      // Another context wants to upgrade: let it.
    },
  });
}

/**
 * Key range covering every row of dictionary `n` in a store keyed `[d, …]`. Arrays sort after
 * numbers and strings in IndexedDB, so `[n, []]` is above every `[n, number|string]` key.
 */
export function dictionaryRange(n: number): IDBKeyRange {
  return IDBKeyRange.bound([n], [n, []]);
}

let shared: Promise<AceDatabase> | null = null;

/** Lazily opened database shared within one context. */
export function getDatabase(): Promise<AceDatabase> {
  if (!shared) {
    shared = openDatabase().then((db) => {
      db.addEventListener('close', () => {
        shared = null;
      });
      db.addEventListener('versionchange', () => {
        db.close();
        shared = null;
      });
      return db;
    });
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}
