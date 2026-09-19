/**
 * Renders one dictionary entry inside its own shadow root with that dictionary's stylesheet.
 */
import { type AceEntry, extractFontFaces } from '@acetylcholine/ace';
import {
  DICTIONARY_BASE_CSS,
  readingTagVisibilityCss,
  renderEntryContent,
  resolveCssAssets,
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

/**
 * Dictionary CSS ready for a shadow root: `ace-asset:` urls resolved to object URLs and
 * `@font-face` rules moved to the document (fonts declared inside a shadow tree are not reliably
 * available to it). Prepared once per dictionary and page.
 */
const preparedStyles = new Map<number, Promise<string>>();
const hoistedFonts = new Set<number>();
const styleCache = new Map<string, string>();

export function renderIntoHost(host: HTMLElement, input: ContentHostInput): void {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = buildStyles('', input);
  root.appendChild(style);

  const content = renderEntryContent(input.entry.content, {
    resolveAsset: (path) => resolveAsset(input.dictionaryNumber, path),
    onLookup: input.onLookup,
  });
  root.appendChild(content);

  if (input.styles) {
    void prepareStyles(input.dictionaryNumber, input.styles).then((css) => {
      // Skip when the host was re-rendered in the meantime.
      if (style.parentNode === root) style.textContent = buildStyles(css, input);
    });
  }
}

/** Forget prepared stylesheets (after an import replaced a dictionary). */
export function clearPreparedStyles(): void {
  preparedStyles.clear();
  styleCache.clear();
}

function prepareStyles(dictionaryNumber: number, styles: string): Promise<string> {
  let p = preparedStyles.get(dictionaryNumber);
  if (!p) {
    p = (async () => {
      const resolved = await resolveCssAssets(styles, (path) =>
        resolveAsset(dictionaryNumber, path),
      );
      const { fontFaces, rest } = extractFontFaces(resolved);
      if (fontFaces.length > 0 && !hoistedFonts.has(dictionaryNumber)) {
        hoistedFonts.add(dictionaryNumber);
        const el = document.createElement('style');
        el.dataset.aceFonts = String(dictionaryNumber);
        el.textContent = fontFaces;
        document.head.appendChild(el);
      }
      return rest;
    })();
    p.catch(() => preparedStyles.delete(dictionaryNumber));
    preparedStyles.set(dictionaryNumber, p);
  }
  return p;
}

function buildStyles(dictionaryCss: string, input: ContentHostInput): string {
  const key = `${input.dictionaryNumber}|${dictionaryCss.length}|${input.primaryReadingTag ?? ''}|${input.customCss}`;
  let css = styleCache.get(key);
  if (css === undefined) {
    css = [
      DICTIONARY_BASE_CSS,
      dictionaryCss,
      readingTagVisibilityCss(input.primaryReadingTag),
      input.customCss,
    ].join('\n');
    if (styleCache.size > 64) styleCache.clear();
    styleCache.set(key, css);
  }
  return css;
}
