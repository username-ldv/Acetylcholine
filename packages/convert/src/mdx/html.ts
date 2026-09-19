/**
 * HTML handling for MDX records on top of htmlparser2 / domhandler: sanitizing, rewriting
 * references, splitting a record into sections per recipe, and extracting readings and variant
 * headwords. Nothing here needs a DOM, so it runs in Node, Bun and browsers alike.
 */
import { rewriteCssUrls } from '@acetylcholine/ace';
import { compile, is, selectAll, selectOne } from 'css-select';
import render from 'dom-serializer';
import { type AnyNode, type ChildNode, type Document, Element, isTag, isText } from 'domhandler';
import { appendChild, prepend, removeElement, textContent } from 'domutils';
import { parseDocument } from 'htmlparser2';
import type { MdxRecipe } from './recipe.ts';

/** A compiled selector (css-select's `CompiledQuery<Element>`). */
type Query = (element: Element) => boolean;

export interface CompiledInteraction {
  query: Query;
  toggleClass: string;
  /** `self`, `parent`, or a selector for `closest()`. */
  target: string;
}

export interface CompiledRecipe {
  recipe: MdxRecipe;
  container: Query | null;
  splitEach: Query | null;
  splitSeparator: Query | null;
  bodyStart: Query | null;
  reading: {
    selector: Query;
    attribute: string | undefined;
    replace: [RegExp, string][];
    split: RegExp | null;
  } | null;
  variants: {
    selector: Query | null;
    pattern: RegExp;
    split: RegExp;
    strip: RegExp | null;
  } | null;
  remove: Query[];
  interactions: CompiledInteraction[];
}

function query(selector: string): Query {
  return compile<AnyNode, Element>(selector);
}

export function compileRecipe(recipe: MdxRecipe): CompiledRecipe {
  const optional = (s: string | undefined): Query | null => (s === undefined ? null : query(s));
  return {
    recipe,
    container: optional(recipe.container),
    splitEach: recipe.split && 'each' in recipe.split ? query(recipe.split.each) : null,
    splitSeparator:
      recipe.split && 'separator' in recipe.split ? query(recipe.split.separator) : null,
    bodyStart: optional(recipe.bodyStart),
    reading: recipe.reading
      ? {
          selector: query(recipe.reading.selector),
          attribute: recipe.reading.attribute,
          replace: (recipe.reading.replace ?? []).map(
            ([re, to]) => [new RegExp(re, 'g'), to] as [RegExp, string],
          ),
          split: recipe.reading.split ? new RegExp(recipe.reading.split) : null,
        }
      : null,
    variants: recipe.variants
      ? {
          selector: optional(recipe.variants.selector),
          pattern: new RegExp(recipe.variants.pattern),
          split: new RegExp(recipe.variants.split ?? '[、，,/／]'),
          strip: recipe.variants.strip ? new RegExp(recipe.variants.strip, 'g') : null,
        }
      : null,
    remove: (recipe.remove ?? []).map(query),
    interactions: (recipe.interactions ?? []).map((i) => ({
      query: query(i.selector),
      toggleClass: i.toggleClass,
      target: i.target ?? 'self',
    })),
  };
}

export function parseRecord(html: string): Document {
  return parseDocument(html);
}

// ---------------------------------------------------------------------------
// Sanitizing and reference rewriting
// ---------------------------------------------------------------------------

export interface SanitizeContext {
  /** Maps a reference as written in the HTML to an asset name, or null when unknown. */
  resolveAsset: (ref: string) => string | null;
  /** `<link rel="stylesheet">` references, in order of first appearance. */
  stylesheets: string[];
  /** Text of removed `<style>` elements. */
  inlineStyles: string[];
  /** Asset names referenced by the content. */
  referencedAssets: Set<string>;
  /** References that resolved to no asset → number of occurrences. */
  missingAssets: Map<string, number>;
  /** Recipe `remove` selectors. */
  removeQueries: Query[];
  /** Recipe `interactions`, emitted as `data-ace-toggle` attributes. */
  interactions: CompiledInteraction[];
}

export const TOGGLE_ATTRIBUTE = 'data-ace-toggle';
export const TOGGLE_TARGET_ATTRIBUTE = 'data-ace-toggle-target';

const DROP_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'meta',
  'base',
  'noscript',
  'template',
  'title',
]);
const URL_ATTRIBUTES = new Set(['src', 'poster', 'href', 'data', 'background']);
const SKIP_REF = /^(?:https?:|data:|blob:|sound:|entry:|mailto:|tel:|#|javascript:|vbscript:)/i;

/**
 * Removes scripts, stylesheets (collected into the context), event handlers and script URLs;
 * rewrites `entry://` links to `ace-lookup:` and file references to `ace-asset:`; unwraps
 * `<html>`/`<body>` wrappers; marks recipe interactions.
 */
export function sanitizeDocument(doc: Document, ctx: SanitizeContext): void {
  const toRemove: Element[] = [];
  const toUnwrap: Element[] = [];
  walkElements(doc.children, (el) => {
    const name = el.name;
    if (name === 'link') {
      const rel = (el.attribs.rel ?? '').toLowerCase();
      const href = el.attribs.href?.trim();
      if (href && (rel.length === 0 || rel.includes('stylesheet'))) {
        if (!ctx.stylesheets.includes(href)) ctx.stylesheets.push(href);
      }
      toRemove.push(el);
      return false;
    }
    if (name === 'style') {
      const css = textContent(el).trim();
      if (css.length > 0) ctx.inlineStyles.push(css);
      toRemove.push(el);
      return false;
    }
    if (name === 'head') {
      toRemove.push(el);
      return true; // still collect nested <link> / <style>
    }
    if (DROP_TAGS.has(name) || ctx.removeQueries.some((q) => is(el, q))) {
      toRemove.push(el);
      return false;
    }
    if (name === 'html' || name === 'body') {
      toUnwrap.push(el);
      return true;
    }
    sanitizeAttributes(el, ctx);
    for (const interaction of ctx.interactions) {
      if (!is(el, interaction.query)) continue;
      el.attribs[TOGGLE_ATTRIBUTE] = interaction.toggleClass;
      el.attribs[TOGGLE_TARGET_ATTRIBUTE] = interaction.target;
      break;
    }
    return true;
  });
  for (const el of toRemove) removeElement(el);
  for (const el of toUnwrap) unwrap(el);
}

function walkElements(nodes: readonly AnyNode[], visit: (el: Element) => boolean): void {
  for (const node of nodes) {
    if (!isTag(node)) continue;
    if (visit(node)) walkElements(node.children, visit);
  }
}

function unwrap(el: Element): void {
  for (const child of [...el.children]) {
    removeElement(child);
    prepend(el, child);
  }
  removeElement(el);
}

function sanitizeAttributes(el: Element, ctx: SanitizeContext): void {
  for (const name of Object.keys(el.attribs)) {
    const value = el.attribs[name] ?? '';
    if (name.startsWith('on') || name === 'srcdoc' || name === 'srcset' || name === 'formaction') {
      delete el.attribs[name];
      continue;
    }
    if (name === 'href' && el.name === 'a') {
      const next = rewriteLink(value);
      if (next === null) delete el.attribs[name];
      else el.attribs[name] = next;
      continue;
    }
    if (URL_ATTRIBUTES.has(name)) {
      if (isScriptUrl(value)) {
        delete el.attribs[name];
        continue;
      }
      const next = rewriteAssetRef(value, ctx);
      if (next !== null) el.attribs[name] = next;
      continue;
    }
    if (name === 'style') {
      const next = sanitizeInlineStyle(value, ctx);
      if (next === null) delete el.attribs[name];
      else el.attribs[name] = next;
    }
  }
}

function isScriptUrl(value: string): boolean {
  return /^\s*(?:javascript:|vbscript:|data:text\/html)/i.test(value);
}

/** `entry://term#x` → `ace-lookup:term`; `entry://#x` → `#x`; script URLs are dropped. */
export function rewriteLink(href: string): string | null {
  const value = href.trim();
  if (isScriptUrl(value)) return null;
  const m = /^entry:\/\/(.*)$/i.exec(value);
  if (!m) return href;
  let target = m[1] ?? '';
  let fragment = '';
  const hash = target.indexOf('#');
  if (hash >= 0) {
    fragment = target.slice(hash);
    target = target.slice(0, hash);
  }
  try {
    target = decodeURIComponent(target);
  } catch {
    // keep as is
  }
  target = target.trim();
  if (target.length === 0) return fragment.length > 1 ? fragment : '#';
  return `ace-lookup:${target}`;
}

/** `001.PNG` → `ace-asset:001.PNG` when the resource exists; null leaves the value alone. */
function rewriteAssetRef(value: string, ctx: SanitizeContext): string | null {
  const ref = value.trim();
  if (ref.length === 0 || SKIP_REF.test(ref)) return null;
  const name = ctx.resolveAsset(ref);
  if (name === null) {
    ctx.missingAssets.set(ref, (ctx.missingAssets.get(ref) ?? 0) + 1);
    return null;
  }
  ctx.referencedAssets.add(name);
  return `ace-asset:${name}`;
}

function sanitizeInlineStyle(style: string, ctx: SanitizeContext): string | null {
  if (/expression\s*\(|javascript:|behavior\s*:|-moz-binding/i.test(style)) return null;
  return rewriteCssUrls(style, (url) => rewriteAssetRef(url, ctx));
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface Section {
  /** Top-level nodes of the section, in order. */
  nodes: ChildNode[];
  /** Nodes before the first `bodyStart` match (all nodes when unset or not found). */
  header: ChildNode[];
  /** Copy of the container element the nodes are wrapped in when serialized, if any. */
  wrapper: Element | null;
}

/** Splits a sanitized record into sections (future entries) as the recipe describes. */
export function splitSections(doc: Document, c: CompiledRecipe): Section[] {
  let scope: ChildNode[] = doc.children;
  let container: Element | null = null;
  if (c.container) {
    const found = selectOne<AnyNode, Element>(c.container, doc.children);
    if (found) {
      container = found;
      scope = found.children;
    }
  }
  const wrapper = (): Element | null =>
    container ? new Element(container.name, { ...container.attribs }) : null;

  let sections: Section[] = [];
  if (c.splitEach) {
    sections = selectAll<AnyNode, Element>(c.splitEach, scope).map((el) => ({
      nodes: [el],
      header: [],
      wrapper: wrapper(),
    }));
  } else if (c.splitSeparator) {
    let current: ChildNode[] = [];
    for (const node of scope) {
      if (isTag(node) && is(node, c.splitSeparator)) {
        if (hasContent(current)) sections.push({ nodes: current, header: [], wrapper: wrapper() });
        current = [];
      } else {
        current.push(node);
      }
    }
    if (hasContent(current)) sections.push({ nodes: current, header: [], wrapper: wrapper() });
  }
  if (sections.length === 0 && hasContent(scope)) {
    sections = [{ nodes: [...scope], header: [], wrapper: wrapper() }];
  }
  for (const s of sections) {
    s.nodes = trimWhitespace(s.nodes);
    s.header = c.bodyStart ? headerOf(s.nodes, c.bodyStart) : s.nodes;
  }
  return sections;
}

function hasContent(nodes: readonly ChildNode[]): boolean {
  return nodes.some((n) => isTag(n) || (isText(n) && n.data.trim().length > 0));
}

function trimWhitespace(nodes: ChildNode[]): ChildNode[] {
  const blank = (n: ChildNode) => isText(n) && n.data.trim().length === 0;
  let start = 0;
  let end = nodes.length;
  while (start < end && blank(nodes[start]!)) start++;
  while (end > start && blank(nodes[end - 1]!)) end--;
  return nodes.slice(start, end);
}

function headerOf(nodes: ChildNode[], bodyStart: Query): ChildNode[] {
  const i = nodes.findIndex((n) => isTag(n) && is(n, bodyStart));
  return i < 0 ? nodes : nodes.slice(0, i);
}

/** Readings of a section per the recipe: text (or attribute) of the first matching element. */
export function extractReadings(section: Section, c: CompiledRecipe): string[] {
  const r = c.reading;
  if (!r) return [];
  const el = selectOne<AnyNode, Element>(r.selector, section.header);
  if (!el) return [];
  let text = r.attribute ? (el.attribs[r.attribute] ?? '') : textContent(el);
  for (const [re, to] of r.replace) text = text.replace(re, to);
  const out: string[] = [];
  for (const part of r.split ? text.split(r.split) : [text]) {
    const t = part.replace(/\s+/g, ' ').trim();
    if (t.length > 0 && !out.includes(t)) out.push(t);
  }
  return out;
}

/** Variant headwords (traditional forms, alternative spellings) listed in the section. */
export function extractVariants(section: Section, key: string, c: CompiledRecipe): string[] {
  const v = c.variants;
  if (!v) return [];
  let text: string;
  if (v.selector) {
    const el = selectOne<AnyNode, Element>(v.selector, section.nodes);
    if (!el) return [];
    text = textContent(el);
  } else if (c.bodyStart) {
    text = textContent(section.header);
  } else {
    return [];
  }
  const m = v.pattern.exec(text);
  if (!m) return [];
  const out: string[] = [];
  for (const raw of (m[1] ?? m[0]).split(v.split)) {
    const form = (v.strip ? raw.replace(v.strip, '') : raw).trim();
    if (plausibleVariant(form, key) && !out.includes(form)) out.push(form);
  }
  return out;
}

function plausibleVariant(form: string, key: string): boolean {
  if (form.length === 0 || form === key) return false;
  if (/[\s（）()<>【】[\]]/.test(form)) return false;
  const a = [...form].length;
  const b = [...key].length;
  return a <= 64 && Math.abs(a - b) <= 2;
}

const RENDER_OPTIONS = { encodeEntities: 'utf8' as const };

/** Serializes a section (moving its nodes into the wrapper first, when there is one). */
export function serializeSection(section: Section): string {
  if (section.wrapper) {
    for (const node of section.nodes) {
      removeElement(node);
      appendChild(section.wrapper, node);
    }
    return render(section.wrapper, RENDER_OPTIONS);
  }
  return render(section.nodes, RENDER_OPTIONS);
}

/** Serializes a whole document (used for samples and tests). */
export function serializeDocument(doc: Document): string {
  return render(doc.children, RENDER_OPTIONS);
}
