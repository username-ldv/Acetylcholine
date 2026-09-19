/**
 * MDX → `.ace` converter. Works on any `MdxSource` (text export, raw `.mdx` + `.mdd`); the source
 * abstraction keeps file access out of this module so it can also run in a browser.
 */
import {
  AceKeyKind,
  type AceManifest,
  type AceReading,
  type AceWriter,
  hash64,
  makeDictionaryId,
  normalizeKey,
  rewriteCssUrls,
} from '@acetylcholine/ace';
import { rewriteRootSelectors } from '../css.ts';
import { detectReadingSystem } from '../reading-system.ts';
import type { ConvertProgress } from '../types.ts';
import { pinyinToZhuyin } from '../zhuyin.ts';
import {
  type CompiledRecipe,
  compileRecipe,
  extractReadings,
  extractVariants,
  parseRecord,
  type SanitizeContext,
  sanitizeDocument,
  serializeSection,
  splitSections,
} from './html.ts';
import { detectRecipe, findRecipe, type MdxRecipe } from './recipe.ts';
import { ResourceIndex } from './resources.ts';
import type { MdxRecord, MdxSource } from './types.ts';

export interface MdxConvertOptions {
  /** Recipe to use: a recipe object or the name of a built-in / extra recipe. Auto-detected otherwise. */
  recipe?: MdxRecipe | string;
  /** Extra recipes considered by name lookup and auto-detection (before the built-ins). */
  recipes?: MdxRecipe[];
  /** Reading tag for every reading (`pinyin`, …); recipe tag or auto-detection otherwise. */
  readingTag?: string;
  /** Add zhuyin readings derived from the pinyin ones (`pinyin-to-zhuyin`). Default: false. */
  deriveZhuyin?: boolean;
  /** Also index readings as lookup keys (kind = reading). Default: false. */
  indexReadings?: boolean;
  title?: string;
  id?: string;
  revision?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  generator?: string;
  onProgress?: (progress: ConvertProgress) => void;
  onWarning?: (message: string) => void;
}

export interface MdxConvertStats {
  recipe: string;
  readingTag: string | null;
  records: number;
  /** Records that were `@@@LINK=` redirects. */
  links: number;
  unresolvedLinks: number;
  entries: number;
  entriesWithReading: number;
  /** Zhuyin readings added by `deriveZhuyin`. */
  derivedReadings: number;
  /** Distinct references that matched no resource. */
  missingAssets: number;
}

export interface MdxConvertResult {
  manifest: AceManifest;
  /** The finished archive when the writer had no sink; otherwise null. */
  blob: Blob | null;
  stats: MdxConvertStats;
}

const PEEK_RECORDS = 200;
const LINK_RE = /^\s*@@@LINK=([^\r\n]+)/;
const EXTERNAL_URL = /^(?:https?:|data:|blob:)/i;

export async function convertMdx(
  source: MdxSource,
  writer: AceWriter,
  options: MdxConvertOptions = {},
): Promise<MdxConvertResult> {
  const progress = options.onProgress ?? (() => {});
  const warn = options.onWarning ?? (() => {});
  const title = (options.title ?? source.title ?? '').trim() || 'Untitled MDX dictionary';
  const resources = new ResourceIndex(source.resources?.list() ?? []);

  // ---- peek at the first records: recipe + reading system detection ------------------------
  progress({ stage: 'index', current: 0, total: 1 });
  const iterator = source.records()[Symbol.asyncIterator]();
  const peeked: MdxRecord[] = [];
  while (peeked.length < PEEK_RECORDS) {
    const next = await iterator.next();
    if (next.done) break;
    peeked.push(next.value);
  }
  const recipe = resolveRecipe(options, title, peeked);
  const compiled = compileRecipe(recipe);
  const readingTag =
    options.readingTag ?? recipe.reading?.tag ?? detectTag(title, peeked, compiled);
  const deriveZhuyin = options.deriveZhuyin === true && readingTag === 'pinyin';
  if (options.deriveZhuyin && !deriveZhuyin) {
    warn(`zhuyin can only be derived from pinyin readings (reading tag: ${readingTag ?? 'none'})`);
  }

  // ---- records → entries ------------------------------------------------------------------
  const ctx: SanitizeContext = {
    resolveAsset: (ref) => resources.resolve(ref),
    stylesheets: [],
    inlineStyles: [],
    referencedAssets: new Set(),
    missingAssets: new Map(),
    removeQueries: compiled.remove,
    interactions: compiled.interactions,
  };
  /** Every headword / variant key → the entries it points to (link targets, alias de-duplication). */
  const entriesByKey = new Map<string, number[]>();
  const links = new Map<string, string>();
  const stats: MdxConvertStats = {
    recipe: recipe.name,
    readingTag,
    records: 0,
    links: 0,
    unresolvedLinks: 0,
    entries: 0,
    entriesWithReading: 0,
    derivedReadings: 0,
    missingAssets: 0,
  };
  let emptyRecords = 0;
  const total = source.recordCount ?? 0;
  const report = () =>
    progress({ stage: 'records', current: stats.records, total: Math.max(total, stats.records) });

  const processRecord = async (record: MdxRecord): Promise<void> => {
    stats.records++;
    if (stats.records % 1000 === 0) report();
    const key = normalizeKey(record.key);
    if (key.length === 0) return;
    const link = LINK_RE.exec(record.html);
    if (link) {
      links.set(key, normalizeKey(link[1] ?? ''));
      stats.links++;
      return;
    }
    if (record.html.trim().length === 0) {
      emptyRecords++;
      return;
    }
    const doc = parseRecord(record.html);
    sanitizeDocument(doc, ctx);
    const ids: number[] = [];
    for (const section of splitSections(doc, compiled)) {
      const readings: AceReading[] = extractReadings(section, compiled).map((text) => ({
        text,
        tags: readingTag ? [readingTag] : [],
      }));
      if (deriveZhuyin) {
        for (const { text } of [...readings]) {
          const zhuyin = pinyinToZhuyin(text);
          if (zhuyin === null || readings.some((r) => r.text === zhuyin)) continue;
          readings.push({ text: zhuyin, tags: ['zhuyin'] });
          stats.derivedReadings++;
        }
      }
      const variants = extractVariants(section, key, compiled);
      const html = serializeSection(section);
      if (html.trim().length === 0) continue;
      const id = await writer.addEntry({
        headwords: [key, ...variants],
        readings,
        content: [{ type: 'html', html }],
        tags: [],
        termTags: [],
        rules: [],
        score: 0,
        sequence: stats.records - 1,
      });
      ids.push(id);
      stats.entries++;
      if (readings.length > 0) stats.entriesWithReading++;
      await writer.addKey(key, id, AceKeyKind.Headword);
      for (const v of variants) {
        await writer.addKey(v, id, AceKeyKind.Variant);
        addKeyed(entriesByKey, normalizeKey(v), id);
      }
      if (options.indexReadings) {
        for (const r of readings)
          if (r.text !== key) await writer.addKey(r.text, id, AceKeyKind.Reading);
      }
    }
    if (ids.length === 0) {
      emptyRecords++;
      return;
    }
    for (const id of ids) addKeyed(entriesByKey, key, id);
  };

  report();
  for (const record of peeked) await processRecord(record);
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    await processRecord(next.value);
  }
  report();
  if (emptyRecords > 0) warn(`${emptyRecords} record(s) had no content and were skipped`);

  // ---- @@@LINK= aliases -------------------------------------------------------------------
  progress({ stage: 'links', current: 0, total: links.size });
  const examples: string[] = [];
  let n = 0;
  for (const [from, to] of links) {
    const ids = resolveLink(to, links, entriesByKey);
    if (!ids) {
      stats.unresolvedLinks++;
      if (examples.length < 5) examples.push(`${from} → ${to}`);
    } else {
      // an alias adds nothing when the same text already reaches the entry as headword/variant
      const own = entriesByKey.get(from);
      for (const id of ids) {
        if (own?.includes(id)) continue;
        await writer.addKey(from, id, AceKeyKind.Alias);
      }
    }
    if (++n % 1000 === 0) progress({ stage: 'links', current: n, total: links.size });
  }
  if (stats.unresolvedLinks > 0) {
    warn(`${stats.unresolvedLinks} @@@LINK target(s) not found, e.g. ${examples.join(', ')}`);
  }

  // ---- styles -----------------------------------------------------------------------------
  progress({ stage: 'styles', current: 0, total: ctx.stylesheets.length + 1 });
  const cssParts: string[] = [];
  const consumed = new Set<string>();
  const cssSeen = new Set<string>();
  const missingCss = new Map<string, number>();
  const prepareCss = (css: string): string => {
    const rewritten = rewriteCssUrls(css, (url) => {
      if (url.length === 0 || EXTERNAL_URL.test(url)) return null;
      const name = resources.resolve(url);
      if (name === null) {
        missingCss.set(url, (missingCss.get(url) ?? 0) + 1);
        return null;
      }
      ctx.referencedAssets.add(name);
      return `ace-asset:${name}`;
    });
    return rewriteRootSelectors(rewritten);
  };
  for (const ref of ctx.stylesheets) {
    const name = resources.resolve(ref);
    const raw = name === null ? undefined : resources.rawName(name);
    const bytes = raw === undefined ? null : await source.resources?.get(raw);
    if (name === null || !bytes) {
      warn(`stylesheet ${ref} referenced by the content was not found`);
      continue;
    }
    consumed.add(name);
    const css = stripBom(new TextDecoder('utf-8').decode(bytes)).trim();
    if (css.length === 0) continue;
    const h = hash64(css);
    if (cssSeen.has(h)) continue;
    cssSeen.add(h);
    cssParts.push(prepareCss(css));
  }
  for (const css of ctx.inlineStyles) {
    const h = hash64(css);
    if (cssSeen.has(h)) continue;
    cssSeen.add(h);
    cssParts.push(prepareCss(css));
  }
  if (recipe.css && recipe.css.trim().length > 0) cssParts.push(prepareCss(recipe.css.trim()));
  const styles = cssParts.join('\n').trim();
  if (styles.length > 0) writer.setStyles(styles);

  // ---- assets -----------------------------------------------------------------------------
  for (const [ref, count] of missingCss) {
    ctx.missingAssets.set(ref, (ctx.missingAssets.get(ref) ?? 0) + count);
  }
  stats.missingAssets = ctx.missingAssets.size;
  if (stats.missingAssets > 0) {
    const top = [...ctx.missingAssets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ref, count]) => `${ref} (×${count})`);
    warn(
      `${stats.missingAssets} referenced file(s) not found in the resources, e.g. ${top.join(', ')}`,
    );
  }
  const assetNames = [...ctx.referencedAssets].filter((name) => !consumed.has(name)).sort();
  for (let i = 0; i < assetNames.length; i++) {
    const name = assetNames[i]!;
    progress({ stage: 'assets', file: name, current: i, total: assetNames.length });
    const raw = resources.rawName(name);
    const bytes = raw === undefined ? null : await source.resources?.get(raw);
    if (!bytes) {
      warn(`asset ${name} could not be read`);
      continue;
    }
    await writer.addAsset(name, bytes);
  }

  // ---- manifest ---------------------------------------------------------------------------
  progress({ stage: 'finish', current: 0, total: 1 });
  const { manifest, blob } = await writer.finish({
    id: options.id ?? makeDictionaryId('mdx', title),
    title,
    revision: options.revision ?? source.revision ?? new Date().toISOString().slice(0, 10),
    description: source.description,
    sourceLanguage: options.sourceLanguage,
    targetLanguage: options.targetLanguage,
    sequenced: true,
    source: {
      format: 'mdx',
      recipe: recipe.name,
      records: stats.records,
      links: stats.links,
      unresolvedLinks: stats.unresolvedLinks,
      derivedReadings: stats.derivedReadings,
      missingAssets: stats.missingAssets,
    },
    generator: options.generator,
  });
  return { manifest, blob, stats };
}

// ---------------------------------------------------------------------------

function resolveRecipe(options: MdxConvertOptions, title: string, sample: MdxRecord[]): MdxRecipe {
  const extra = options.recipes ?? [];
  if (typeof options.recipe === 'object') return options.recipe;
  if (typeof options.recipe === 'string') {
    const found = findRecipe(options.recipe, extra);
    if (!found) throw new Error(`Unknown MDX recipe "${options.recipe}"`);
    return found;
  }
  const html = sample
    .filter((r) => !LINK_RE.test(r.html))
    .slice(0, 50)
    .map((r) => r.html)
    .join('\n');
  return detectRecipe(title, html, extra);
}

/** Reading system guessed from the readings the recipe extracts from the first records. */
function detectTag(title: string, sample: MdxRecord[], compiled: CompiledRecipe): string | null {
  if (!compiled.reading) return null;
  const samples: string[] = [];
  const ctx: SanitizeContext = {
    resolveAsset: () => null,
    stylesheets: [],
    inlineStyles: [],
    referencedAssets: new Set(),
    missingAssets: new Map(),
    removeQueries: compiled.remove,
    interactions: [],
  };
  for (const record of sample) {
    if (LINK_RE.test(record.html)) continue;
    const doc = parseRecord(record.html);
    sanitizeDocument(doc, ctx);
    for (const section of splitSections(doc, compiled)) {
      samples.push(...extractReadings(section, compiled));
    }
  }
  return detectReadingSystem(title, samples);
}

/** Follows `@@@LINK=` chains (bounded) to the entries of the final target. */
function resolveLink(
  to: string,
  links: Map<string, string>,
  entriesByKey: Map<string, number[]>,
): number[] | null {
  let target: string | undefined = to;
  const seen = new Set<string>();
  for (let hop = 0; hop < 8 && target !== undefined && !seen.has(target); hop++) {
    seen.add(target);
    const ids = entriesByKey.get(target);
    if (ids) return ids;
    target = links.get(target);
  }
  return null;
}

function addKeyed(map: Map<string, number[]>, key: string, id: number): void {
  const list = map.get(key);
  if (!list) map.set(key, [id]);
  else if (!list.includes(id)) list.push(id);
}

function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}
