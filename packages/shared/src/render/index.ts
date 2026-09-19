import type { AceContent } from '@acetylcholine/ace';
import { renderHtml } from './html.ts';
import { attachInteractionHandler } from './interactions.ts';
import { attachLinkHandler, type RenderContext, renderBlock } from './structured.ts';

export * from './css.ts';
export * from './html.ts';
export * from './interactions.ts';
export * from './reading.ts';
export * from './structured.ts';

/**
 * Renders every content block of an entry (structured, text, image, deinflection and sanitized
 * HTML) into one container with a delegated internal-link handler.
 */
export function renderEntryContent(blocks: readonly AceContent[], ctx: RenderContext): HTMLElement {
  const doc = ctx.document ?? document;
  const root = doc.createElement('div');
  root.className = 'ace-content';
  for (const block of blocks) {
    const node = block.type === 'html' ? renderHtml(block.html, ctx) : renderBlock(block, ctx);
    if (node) root.appendChild(node);
  }
  attachLinkHandler(root, ctx);
  attachInteractionHandler(root);
  return root;
}

/**
 * Base stylesheet for a dictionary's shadow root: sensible defaults for the image markup and
 * neutral inheritance for everything else. Dictionary CSS is appended after it.
 */
export const DICTIONARY_BASE_CSS = `
:host, .ace-content, .ace-structured, .ace-html { display: contents; }
.ace-content { overflow-wrap: anywhere; }
.ace-text { display: block; white-space: pre-wrap; }
a { color: var(--ace-link, #2563eb); text-decoration: none; cursor: pointer; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
.gloss-image-link { display: inline-block; vertical-align: middle; text-decoration: none; position: relative; }
.gloss-image-link[data-collapsed="true"] > .gloss-image-container { display: none; }
.gloss-image-container { display: inline-flex; align-items: center; justify-content: center; overflow: hidden; }
.gloss-image { display: block; object-fit: contain; width: 100%; height: 100%; }
.gloss-image-link[data-image-rendering="pixelated"] .gloss-image { image-rendering: pixelated; }
.gloss-image-link[data-image-rendering="crisp-edges"] .gloss-image { image-rendering: crisp-edges; }
.gloss-image-link[data-appearance="monochrome"] .gloss-image { filter: var(--ace-monochrome-filter, none); }
.gloss-image-description { display: block; font-size: 0.85em; opacity: 0.8; }
.gloss-image-link[data-missing="true"] { opacity: 0.5; }
ruby > rt { font-size: 0.6em; }
table { border-collapse: collapse; }
td, th { border: 1px solid currentColor; padding: 0.15em 0.4em; }
ol, ul { padding-inline-start: 1.5em; margin: 0.25em 0; }
details > summary { cursor: pointer; }
[data-ace-toggle] { cursor: pointer; }
.ace-deinflection-rules { opacity: 0.7; font-size: 0.85em; }
`;
