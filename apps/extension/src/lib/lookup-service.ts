/**
 * Background lookup service: candidates from the profile's language adapter, one IndexedDB
 * transaction per lookup, grouping by (word, pronunciation), and an LRU of recent results.
 */
import type { AceEntry } from '@acetylcholine/ace';
import {
  type DictionaryInfo,
  getActiveProfile,
  getLanguageAdapter,
  groupHits,
  type LookupHit,
  type LookupResult,
  resolveDictionaryPreferences,
  type Settings,
} from '@acetylcholine/shared';
import { type DictionaryRecord, listDictionaries, queryCandidates, toDictionaryInfo } from './db';

const MAX_SCAN_TEXT = 256;

class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

export class LookupService {
  private readonly cache = new LruCache<string, LookupResult>(256);
  private dictionaries: Promise<DictionaryRecord[]> | null = null;

  constructor(private readonly getSettings: () => Promise<Settings>) {}

  /** Drops the dictionary list and every cached result (after import/delete). */
  invalidateDictionaries(): void {
    this.dictionaries = null;
    this.cache.clear();
  }

  /** Drops cached results (after a settings change). */
  invalidateResults(): void {
    this.cache.clear();
  }

  async readyDictionaries(): Promise<DictionaryRecord[]> {
    if (!this.dictionaries) {
      this.dictionaries = listDictionaries().then((list) =>
        list.filter((d) => d.status === 'ready'),
      );
      this.dictionaries.catch(() => {
        this.dictionaries = null;
      });
    }
    return this.dictionaries;
  }

  async listDictionaryInfo(): Promise<DictionaryInfo[]> {
    return (await this.readyDictionaries()).map(toDictionaryInfo);
  }

  async lookup(text: string, profileId?: string, fresh = false): Promise<LookupResult> {
    const started = performance.now();
    const settings = await this.getSettings();
    const profile =
      (profileId && settings.profiles.find((p) => p.id === profileId)) ||
      getActiveProfile(settings);
    const adapter = getLanguageAdapter(profile.language);
    const raw = text.slice(0, MAX_SCAN_TEXT);
    const candidates = adapter.candidates(raw, profile.scanning.scanLength);
    const empty = (): LookupResult => ({
      text: raw,
      groups: [],
      matchLength: 0,
      dictionaries: [],
      elapsed: performance.now() - started,
      cached: false,
    });
    if (candidates.length === 0) return empty();

    const scanned = raw.slice(0, candidates[0]!.length);
    const cacheKey = `${profile.id}|${scanned}`;
    if (!fresh) {
      const hit = this.cache.get(cacheKey);
      if (hit) return { ...hit, text: raw, elapsed: performance.now() - started, cached: true };
    }

    const dictionaries = await this.readyDictionaries();
    const prefs = resolveDictionaryPreferences(
      profile,
      dictionaries.map((d) => d.id),
    );
    const byId = new Map(dictionaries.map((d) => [d.id, d]));
    const enabledIds = prefs.filter((p) => p.enabled && byId.has(p.id)).map((p) => p.id);
    const numbers = new Set<number>();
    const idByNumber = new Map<number, string>();
    for (const id of enabledIds) {
      const d = byId.get(id)!;
      numbers.add(d.n);
      idByNumber.set(d.n, d.id);
    }
    if (numbers.size === 0) return empty();

    const matches = await queryCandidates(candidates, numbers);
    const hits: LookupHit[] = matches.map((m) => {
      const { d, ...entry } = m.entry;
      return {
        dictionary: idByNumber.get(d)!,
        entry: entry as AceEntry,
        kinds: m.kinds,
        matched: m.candidate.text,
        length: m.candidate.length,
      };
    });
    const groups = groupHits(hits, enabledIds);
    const used = new Set<string>();
    for (const g of groups) for (const e of g.entries) used.add(e.dictionary);
    const result: LookupResult = {
      text: raw,
      groups,
      matchLength: groups[0]?.length ?? 0,
      dictionaries: enabledIds
        .filter((id) => used.has(id))
        .map((id) => toDictionaryInfo(byId.get(id)!)),
      elapsed: performance.now() - started,
      cached: false,
    };
    this.cache.set(cacheKey, result);
    return result;
  }
}
