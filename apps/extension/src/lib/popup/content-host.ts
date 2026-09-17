/**
 * Renders one dictionary entry inside its own shadow root with that dictionary's stylesheet.
 */
import type { AceEntry } from '@acetylcholine/ace';
import {
  DICTIONARY_BASE_CSS,
  readingTagVisibilityCss,
  renderEntryContent,
} from '@acetylcholine/shared';
import { resolveAsset } from './assets.ts';

export interface ContentHostInput {
  entry: AceEntry;
  dictionaryNumber: number;
  /** The dictionary's `styles.css` (already stripped of reading-tag rules). */
  styles: string | null;
  /** User CSS for this dictionary. */
  customCss: string;
  /** Reading system whose tagged nodes stay visible; null shows all. */
  primaryReadingTag: string | null;
  onLookup: (term: string) => void;
}

const styleCache = new Map<string, string>();

export function renderIntoHost(host: HTMLElement, input: ContentHostInput): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = buildStyles(input);
  root.appendChild(style);

  const content = renderEntryContent(input.entry.content, {
    resolveAsset: (path) => resolveAsset(input.dictionaryNumber, path),
    onLookup: input.onLookup,
  });
  root.appendChild(content);
}

function buildStyles(input: ContentHostInput): string {
  const key = `${input.dictionaryNumber}|${input.primaryReadingTag ?? ''}|${input.customCss}`;
  let css = styleCache.get(key);
  if (css === undefined) {
    css = [
      DICTIONARY_BASE_CSS,
      input.styles ?? '',
      readingTagVisibilityCss(input.primaryReadingTag),
      input.customCss,
    ].join('\n');
    if (styleCache.size > 64) styleCache.clear();
    styleCache.set(key, css);
  }
  return css;
}
