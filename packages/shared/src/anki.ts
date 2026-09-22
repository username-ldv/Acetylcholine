/**
 * Anki note assembly: the data the popup collects for one result group, the field markers a
 * user can put into a note-type field, and their expansion. Pure functions; the AnkiConnect
 * client lives in the extension.
 */
import type { AceReading } from '@acetylcholine/ace';
import { selectReadings } from './render/reading.ts';

/** One dictionary's rendered content for a group, ready for a note field. */
export interface AnkiGlossaryBlock {
  /** Dictionary id. */
  dictionary: string;
  title: string;
  /** Sanitized HTML with images pointing at Anki media file names. */
  html: string;
  /** Plain-text rendering of the same content. */
  text: string;
  /** Media file name of the dictionary's scoped stylesheet (`_ace-<dictionary>.css`), if any. */
  stylesheet?: string;
}

/** The sentence the scanned word was found in, split around the match. */
export interface AnkiSentence {
  prefix: string;
  body: string;
  suffix: string;
}

/** Where a lookup happened; shown by the popup and used for `{sentence}`, `{url}`, … */
export interface LookupContext {
  sentence: AnkiSentence | null;
  url: string;
  documentTitle: string;
}

/** Everything a note is built from. JSON-serialisable (popup → background). */
export interface AnkiNoteData {
  /** Profile whose reading preferences apply; the active profile when omitted. */
  profileId?: string;
  /** Canonical headword (the scanned form first). */
  expression: string;
  /** Every written form, `expression` first. */
  headwords: string[];
  readings: AceReading[];
  glossary: AnkiGlossaryBlock[];
  sentence: AnkiSentence | null;
  url: string;
  documentTitle: string;
}

/**
 * Media file name prefix of exported dictionary stylesheets. The leading underscore keeps Anki's
 * "Check Media" from treating them as unused.
 */
export const ANKI_STYLESHEET_PREFIX = '_ace-';

/** A dictionary asset to store in Anki's media folder before the note is added. */
export interface AnkiMediaFile {
  filename: string;
  /** Base64 of the file contents. */
  data: string;
}

export interface AnkiMarker {
  name: string;
  description: string;
}

/** Markers a field template may contain. `{reading:<tag>}` and `{glossary:<dictionary>}` take an argument. */
export const ANKI_MARKERS: readonly AnkiMarker[] = [
  { name: '{expression}', description: 'The word as scanned (canonical headword).' },
  { name: '{headwords}', description: 'Every written form, separated by " / ".' },
  { name: '{variants}', description: 'The other written forms only.' },
  { name: '{reading}', description: 'Readings in the primary reading system of the profile.' },
  { name: '{readings}', description: 'Readings in every system.' },
  { name: '{reading:pinyin}', description: 'Readings in one system (any tag: pinyin, zhuyin, …).' },
  {
    name: '{glossary}',
    description: 'Every dictionary’s definitions as HTML, each under its title.',
  },
  {
    name: '{glossary:<dictionary>}',
    description: 'One dictionary’s definitions (by title or id), no title.',
  },
  { name: '{glossary-text}', description: 'Every dictionary’s definitions as plain text.' },
  { name: '{dictionary}', description: 'Title of the first dictionary with a definition.' },
  { name: '{dictionaries}', description: 'Titles of every dictionary with a definition.' },
  { name: '{sentence}', description: 'The sentence the word was found in.' },
  { name: '{cloze-prefix}', description: 'The sentence before the word.' },
  { name: '{cloze-body}', description: 'The matched text inside the sentence.' },
  { name: '{cloze-suffix}', description: 'The sentence after the word.' },
  { name: '{url}', description: 'Address of the page.' },
  { name: '{document-title}', description: 'Title of the page.' },
];

export interface AnkiMarkerContext {
  /** Reading tags in order of preference (the profile's `readingTags`). */
  readingTags: readonly string[];
  /** Link each dictionary's stored stylesheet from the glossary (default: yes when present). */
  glossaryStyles?: boolean;
}

/** One dictionary's block of a glossary: scope element, stylesheet link, optional title, content. */
function glossaryEntryHtml(
  block: AnkiGlossaryBlock,
  ctx: AnkiMarkerContext,
  withTitle: boolean,
): string {
  const link =
    block.stylesheet && ctx.glossaryStyles !== false
      ? `<link rel="stylesheet" href="${escapeHtml(block.stylesheet)}">`
      : '';
  const title = withTitle ? `<div class="ace-glossary-title">${escapeHtml(block.title)}</div>` : '';
  return (
    `<div class="ace-glossary-entry" data-dictionary="${escapeHtml(block.title)}"` +
    ` data-dictionary-id="${escapeHtml(block.dictionary)}">${link}${title}${block.html}</div>`
  );
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

const MARKER_PATTERN = /\{([a-z][a-z0-9-]*)(?::([^{}]+))?\}/g;

/** Value of one marker, or null when the marker is unknown (it is then left untouched). */
export function ankiMarkerValue(
  name: string,
  argument: string | undefined,
  data: AnkiNoteData,
  ctx: AnkiMarkerContext,
): string | null {
  const joinReadings = (list: readonly AceReading[]) =>
    escapeHtml(list.map((r) => r.text).join(' / '));
  switch (name) {
    case 'expression':
      return escapeHtml(data.expression);
    case 'headwords':
      return escapeHtml(data.headwords.join(' / '));
    case 'variants':
      return escapeHtml(data.headwords.filter((h) => h !== data.expression).join(' / '));
    case 'reading': {
      if (argument) return joinReadings(data.readings.filter((r) => r.tags.includes(argument)));
      return joinReadings(selectReadings(data.readings, ctx.readingTags).primary);
    }
    case 'readings':
      return joinReadings(data.readings);
    case 'glossary': {
      if (argument) {
        const wanted = argument.trim();
        return data.glossary
          .filter((b) => b.dictionary === wanted || b.title === wanted)
          .map((b) => glossaryEntryHtml(b, ctx, false))
          .join('');
      }
      return renderGlossaryHtml(data.glossary, ctx);
    }
    case 'glossary-text':
      return data.glossary.map((b) => textToHtml(`${b.title}\n${b.text}`)).join('<br><br>');
    case 'dictionary':
      return escapeHtml(data.glossary[0]?.title ?? '');
    case 'dictionaries':
      return escapeHtml(data.glossary.map((b) => b.title).join(', '));
    case 'sentence':
      return data.sentence
        ? escapeHtml(data.sentence.prefix + data.sentence.body + data.sentence.suffix)
        : '';
    case 'cloze-prefix':
      return escapeHtml(data.sentence?.prefix ?? '');
    case 'cloze-body':
      return escapeHtml(data.sentence?.body ?? '');
    case 'cloze-suffix':
      return escapeHtml(data.sentence?.suffix ?? '');
    case 'url':
      return escapeHtml(data.url);
    case 'document-title':
      return escapeHtml(data.documentTitle);
    default:
      return null;
  }
}

/** `{glossary}`: every dictionary's HTML under its title, in one container. */
export function renderGlossaryHtml(
  blocks: readonly AnkiGlossaryBlock[],
  ctx: AnkiMarkerContext,
): string {
  if (blocks.length === 0) return '';
  const parts = blocks.map((b) => glossaryEntryHtml(b, ctx, true));
  return `<div class="ace-glossary">${parts.join('')}</div>`;
}

/** Replaces every known marker in a field template; unknown ones stay as written. */
export function expandAnkiTemplate(
  template: string,
  data: AnkiNoteData,
  ctx: AnkiMarkerContext,
): string {
  return template.replace(MARKER_PATTERN, (whole, name: string, argument?: string) => {
    const value = ankiMarkerValue(name, argument, data, ctx);
    return value === null ? whole : value;
  });
}

/** Expands every configured field template; fields with an empty template are omitted. */
export function buildAnkiFields(
  templates: Readonly<Record<string, string>>,
  data: AnkiNoteData,
  ctx: AnkiMarkerContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, template] of Object.entries(templates)) {
    if (template.trim().length === 0) continue;
    out[field] = expandAnkiTemplate(template, data, ctx);
  }
  return out;
}

/** Escapes a value for use inside a quoted Anki search term. */
export function escapeAnkiSearch(value: string): string {
  return value.replace(/[\\"*_]/g, '\\$&');
}

/**
 * Anki search that finds notes of `model` whose `field` equals `value`: the same rule Anki
 * applies for duplicates (same note type, same first field), optionally limited to a deck.
 */
export function ankiDuplicateQuery(options: {
  model: string;
  field: string;
  value: string;
  deck?: string;
}): string {
  const parts = [
    `"note:${escapeAnkiSearch(options.model)}"`,
    `"${escapeAnkiSearch(options.field)}:${escapeAnkiSearch(options.value)}"`,
  ];
  if (options.deck) parts.push(`"deck:${escapeAnkiSearch(options.deck)}"`);
  return parts.join(' ');
}
