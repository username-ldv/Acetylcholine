/**
 * Popup side of the Anki export: renders a group's entries to HTML meant for a note field
 * (images renamed to Anki media files, internal links flattened, hidden reading systems
 * dropped) and collects the media those images need.
 */
import { type AceReading, extractFontFaces, rewriteCssUrls } from '@acetylcholine/ace';
import {
  ACE_ASSET_PREFIX,
  ANKI_STYLESHEET_PREFIX,
  type AnkiGlossaryBlock,
  type AnkiMediaFile,
  type AnkiNoteData,
  contentReadingTag,
  DICTIONARY_BASE_CSS,
  type DictionaryInfo,
  decodeAssetPath,
  LOOKUP_ATTRIBUTE,
  type LookupContext,
  type LookupEntry,
  type PopupProfileOptions,
  renderEntryContent,
  scopeCss,
  selectReadings,
} from '@acetylcholine/shared';
import { getAssetBlob } from '../db/assets.ts';
import { getDictionaryStyles } from '../popup/dictionary-styles.ts';

export interface MediaRef {
  dictionaryNumber: number;
  /** Asset path inside the dictionary; empty for generated files. */
  path: string;
  filename: string;
  /** Contents of a generated text file (a stylesheet) instead of a stored asset. */
  text?: string;
}

export interface NoteBuild {
  note: AnkiNoteData;
  media: MediaRef[];
}

export interface NoteSource {
  headwords: string[];
  readings: AceReading[];
  entries: LookupEntry[];
  dictionaries: Map<string, DictionaryInfo>;
  options: PopupProfileOptions;
  context: LookupContext;
  profileId?: string;
  /** Prefix each definition with its reading (the "by dictionary" layout with several pronunciations). */
  readingBadges?: boolean;
}

/** Builds the note data for one result group or word block. */
export async function buildNoteData(source: NoteSource): Promise<NoteBuild> {
  const media = new Map<string, MediaRef>();
  const byDictionary = new Map<string, LookupEntry[]>();
  for (const e of source.entries) {
    let list = byDictionary.get(e.dictionary);
    if (!list) {
      list = [];
      byDictionary.set(e.dictionary, list);
    }
    list.push(e);
  }

  const glossary: AnkiGlossaryBlock[] = [];
  for (const [id, items] of byDictionary) {
    const dictionary = source.dictionaries.get(id);
    if (!dictionary) continue;
    const primaryTag = contentReadingTag(
      dictionary.readingTags,
      source.options.readingTags,
      source.options.readingDisplay,
    );
    const container = document.createElement('div');
    for (const item of items) {
      const pending: Promise<unknown>[] = [];
      const rendered = renderEntryContent(item.entry.content, {
        document,
        resolveAsset: (path) => {
          const ref = mediaRef(dictionary, path);
          media.set(`${ref.dictionaryNumber}|${ref.path}`, ref);
          const p = Promise.resolve(ref.filename);
          pending.push(p);
          return p;
        },
      });
      // The renderer sets image sources in `.then` callbacks of the promises above.
      await Promise.all(pending);
      await Promise.resolve();
      cleanForExport(rendered, primaryTag);
      const sense = document.createElement('div');
      sense.className = 'ace-glossary-sense';
      if (source.readingBadges && items.length > 1 && item.entry.readings.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'ace-glossary-reading';
        badge.textContent = selectReadings(item.entry.readings, source.options.readingTags)
          .primary.map((r) => r.text)
          .join(' / ');
        sense.appendChild(badge);
        sense.appendChild(document.createTextNode(' '));
      }
      sense.appendChild(rendered);
      container.appendChild(sense);
    }
    glossary.push({
      dictionary: id,
      title: dictionary.title,
      html: container.innerHTML,
      text: plainText(container),
      stylesheet: await exportStylesheet(dictionary, media),
    });
  }

  return {
    note: {
      profileId: source.profileId,
      expression: source.headwords[0] ?? '',
      headwords: source.headwords,
      readings: source.readings,
      glossary,
      sentence: source.context.sentence,
      url: source.context.url,
      documentTitle: source.context.documentTitle,
    },
    media: [...media.values()],
  };
}

/** Reads the referenced assets from the database as base64 for `storeMediaFile`. */
export async function collectMedia(refs: readonly MediaRef[]): Promise<AnkiMediaFile[]> {
  const out: AnkiMediaFile[] = [];
  for (const ref of refs) {
    const blob =
      ref.text !== undefined
        ? new Blob([ref.text], { type: 'text/css' })
        : await getAssetBlob(ref.dictionaryNumber, ref.path);
    if (!blob) continue;
    out.push({ filename: ref.filename, data: await toBase64(blob) });
  }
  return out;
}

/**
 * Anki media file name for a dictionary asset: recognisable, unique per (dictionary, path),
 * and made of characters every file system accepts.
 */
export function mediaRef(dictionary: DictionaryInfo, path: string): MediaRef {
  const base = (path.split('/').pop() ?? path).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60);
  return {
    dictionaryNumber: dictionary.n,
    path,
    filename: `ace-${dictionarySlug(dictionary.id)}-${fnv1a(path)}-${base}`,
  };
}

function dictionarySlug(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/** Selector of one dictionary's block inside an exported glossary (see `renderGlossaryHtml`). */
export function glossaryScope(dictionaryId: string): string {
  return `.ace-glossary-entry[data-dictionary-id="${dictionaryId.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * The dictionary's stylesheet as it should live in Anki's media folder: the popup's base rules
 * plus the dictionary's own, confined to that dictionary's glossary block, `@font-face` dropped
 * (fonts are not exported) and `ace-asset:` images renamed like the content's. Registered as a
 * media file to store; returns its name, or undefined for dictionaries without styles.
 */
async function exportStylesheet(
  dictionary: DictionaryInfo,
  media: Map<string, MediaRef>,
): Promise<string | undefined> {
  const styles = dictionary.hasStyles ? await getDictionaryStyles(dictionary.id) : null;
  if (!styles) return undefined;
  const { rest } = extractFontFaces(styles);
  const withMedia = rewriteCssUrls(rest, (url) => {
    if (!url.startsWith(ACE_ASSET_PREFIX)) return null;
    const ref = mediaRef(dictionary, decodeAssetPath(url.slice(ACE_ASSET_PREFIX.length)));
    media.set(`${ref.dictionaryNumber}|${ref.path}`, ref);
    return ref.filename;
  });
  // `:host` is the shadow root in the popup; the block element must keep its own box here.
  const base = DICTIONARY_BASE_CSS.replace(':host, ', '');
  const css = scopeCss(`${base}\n${withMedia}`, glossaryScope(dictionary.id));
  const filename = `${ANKI_STYLESHEET_PREFIX}${dictionarySlug(dictionary.id)}.css`;
  media.set(`css|${filename}`, { dictionaryNumber: dictionary.n, path: '', filename, text: css });
  return filename;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Makes rendered content self-contained: drops reading-tagged nodes of other systems (the
 * popup hides them with CSS), turns internal lookup links into plain spans, and unwraps image
 * links so only the `<img>` (pointing at the media file) remains.
 */
function cleanForExport(root: HTMLElement, primaryTag: string | null): void {
  if (primaryTag !== null) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-sc-reading-tag]')) {
      if (el.getAttribute('data-sc-reading-tag') !== primaryTag) el.remove();
    }
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>(`a[${LOOKUP_ATTRIBUTE}]`)) {
    const span = document.createElement('span');
    span.className = 'ace-link';
    span.append(...a.childNodes);
    a.replaceWith(span);
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a.gloss-image-link')) {
    a.replaceWith(...a.childNodes);
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href="#"]')) {
    a.replaceWith(...a.childNodes);
  }
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'TR', 'OL', 'UL', 'BR', 'DETAILS', 'SUMMARY']);

/** Text of the content with line breaks at block boundaries (a detached element has no `innerText`). */
function plainText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('*')) {
    if (BLOCK_TAGS.has(el.tagName)) el.append('\n');
  }
  return (clone.textContent ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
