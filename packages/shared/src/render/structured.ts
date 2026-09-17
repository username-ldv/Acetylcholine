/**
 * Renders Yomitan-style structured content into DOM nodes. Written from the format description;
 * the produced markup uses the same `data-sc-*` attributes and image class names that dictionary
 * stylesheets target, so existing `styles.css` files apply unchanged.
 */
import type {
  AceContent,
  ImageOptions,
  StructuredContent,
  StructuredContentData,
  StructuredContentNode,
  StructuredContentStyle,
} from '@acetylcholine/ace';

export interface RenderContext {
  document?: Document;
  /** Resolves an asset path to a URL (blob URL); null when missing. */
  resolveAsset: (path: string) => Promise<string | null>;
  /** Called when an internal link (`?query=`, `ace-lookup:`) is activated. */
  onLookup?: (term: string) => void;
}

export const LOOKUP_ATTRIBUTE = 'data-ace-lookup';

const SIMPLE_TAGS = new Set([
  'ruby',
  'rt',
  'rp',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'span',
  'div',
  'ol',
  'ul',
  'li',
  'details',
  'summary',
]);

const EM_NUMBER_STYLES = new Set(['marginTop', 'marginLeft', 'marginRight', 'marginBottom']);

/** Renders an entry's content blocks into one container. */
export function renderContent(blocks: readonly AceContent[], ctx: RenderContext): HTMLElement {
  const doc = ctx.document ?? document;
  const root = doc.createElement('div');
  root.className = 'ace-content';
  for (const block of blocks) {
    const node = renderBlock(block, ctx);
    if (node) root.appendChild(node);
  }
  attachLinkHandler(root, ctx);
  return root;
}

export function renderBlock(block: AceContent, ctx: RenderContext): Node | null {
  const doc = ctx.document ?? document;
  switch (block.type) {
    case 'text': {
      const el = doc.createElement('div');
      el.className = 'ace-text';
      el.textContent = block.text;
      return el;
    }
    case 'structured': {
      const el = doc.createElement('div');
      el.className = 'ace-structured';
      el.appendChild(renderStructured(block.content, ctx));
      return el;
    }
    case 'html': {
      // Handled by the HTML renderer (DOMPurify); kept here for completeness.
      const el = doc.createElement('div');
      el.className = 'ace-html';
      el.textContent = block.html.replace(/<[^>]+>/g, '');
      return el;
    }
    case 'image':
      return renderImage(block.path, block, ctx);
    case 'deinflection': {
      const el = doc.createElement('div');
      el.className = 'ace-deinflection';
      const a = doc.createElement('a');
      a.href = '#';
      a.setAttribute(LOOKUP_ATTRIBUTE, block.term);
      a.textContent = block.term;
      el.appendChild(a);
      if (block.rules.length > 0) {
        const rules = doc.createElement('span');
        rules.className = 'ace-deinflection-rules';
        rules.textContent = ` (${block.rules.join(', ')})`;
        el.appendChild(rules);
      }
      return el;
    }
    default:
      return null;
  }
}

/** Renders a structured-content tree. */
export function renderStructured(content: StructuredContent, ctx: RenderContext): Node {
  const doc = ctx.document ?? document;
  if (typeof content === 'string') return doc.createTextNode(content);
  if (Array.isArray(content)) {
    const frag = doc.createDocumentFragment();
    for (const child of content) frag.appendChild(renderStructured(child, ctx));
    return frag;
  }
  if (content === null || typeof content !== 'object') return doc.createTextNode('');
  return renderNode(content, ctx);
}

function renderNode(node: StructuredContentNode, ctx: RenderContext): Node {
  const doc = ctx.document ?? document;
  const tag = typeof node.tag === 'string' ? node.tag : 'span';
  switch (tag) {
    case 'br': {
      const el = doc.createElement('br');
      applyData(el, (node as { data?: StructuredContentData }).data);
      return el;
    }
    case 'img': {
      const n = node as Extract<StructuredContentNode, { tag: 'img' }>;
      const el = renderImage(n.path, n, ctx, {
        verticalAlign: n.verticalAlign,
        border: n.border,
        borderRadius: n.borderRadius,
        sizeUnits: n.sizeUnits,
      });
      applyData(el, n.data);
      return el;
    }
    case 'a': {
      const n = node as Extract<StructuredContentNode, { tag: 'a' }>;
      const el = doc.createElement('a');
      const href = typeof n.href === 'string' ? n.href : '';
      const lookup = internalLinkTerm(href);
      if (lookup !== null) {
        el.href = '#';
        el.setAttribute(LOOKUP_ATTRIBUTE, lookup);
      } else if (/^https?:\/\//i.test(href)) {
        el.href = href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
      } else {
        el.href = '#';
      }
      if (n.lang) el.lang = n.lang;
      if (n.content !== undefined) el.appendChild(renderStructured(n.content, ctx));
      return el;
    }
    default: {
      const name = SIMPLE_TAGS.has(tag) ? tag : 'span';
      const el = doc.createElement(name);
      const n = node as {
        content?: StructuredContent;
        data?: StructuredContentData;
        style?: StructuredContentStyle;
        title?: string;
        open?: boolean;
        lang?: string;
        colSpan?: number;
        rowSpan?: number;
      };
      applyData(el, n.data);
      if (n.style) applyStyle(el, n.style);
      if (typeof n.title === 'string') el.title = n.title;
      if (typeof n.lang === 'string') el.lang = n.lang;
      if (name === 'details' && n.open) el.setAttribute('open', '');
      if (name === 'td' || name === 'th') {
        const cell = el as HTMLTableCellElement;
        if (typeof n.colSpan === 'number') cell.colSpan = n.colSpan;
        if (typeof n.rowSpan === 'number') cell.rowSpan = n.rowSpan;
      }
      if (!SIMPLE_TAGS.has(tag)) el.setAttribute('data-ace-tag', tag);
      if (n.content !== undefined) el.appendChild(renderStructured(n.content, ctx));
      return el;
    }
  }
}

/** Maps `data: { foo: "bar" }` to `data-sc-foo="bar"` (camelCase keys become kebab-case). */
export function applyData(el: HTMLElement, data: StructuredContentData | undefined): void {
  if (!data) return;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== 'string') continue;
    const kebab = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/[^a-z0-9-]/g, '');
    if (kebab.length === 0) continue;
    el.setAttribute(`data-sc-${kebab}`, value);
  }
}

export function applyStyle(el: HTMLElement, style: StructuredContentStyle): void {
  for (const [key, raw] of Object.entries(style)) {
    if (raw === undefined || raw === null) continue;
    let value: string;
    if (Array.isArray(raw)) value = raw.join(' ');
    else if (typeof raw === 'number') value = EM_NUMBER_STYLES.has(key) ? `${raw}em` : String(raw);
    else if (typeof raw === 'string') value = raw;
    else continue;
    const prop = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    el.style.setProperty(prop, value);
  }
}

interface ImageExtras {
  verticalAlign?: string;
  border?: string;
  borderRadius?: string;
  sizeUnits?: 'px' | 'em';
}

/**
 * Image markup: `a.gloss-image-link > span.gloss-image-container > img.gloss-image`, plus an
 * optional description. The source is resolved asynchronously from the asset store.
 */
export function renderImage(
  path: string,
  options: ImageOptions,
  ctx: RenderContext,
  extras: ImageExtras = {},
): HTMLElement {
  const doc = ctx.document ?? document;
  const link = doc.createElement('a');
  link.className = 'gloss-image-link';
  link.href = '#';
  link.setAttribute('data-ace-image', path);
  const units = extras.sizeUnits ?? 'px';
  link.setAttribute('data-size-units', units);
  link.setAttribute(
    'data-image-rendering',
    options.imageRendering ?? (options.pixelated ? 'pixelated' : 'auto'),
  );
  link.setAttribute('data-appearance', options.appearance ?? 'auto');
  link.setAttribute('data-background', String(options.background ?? true));
  link.setAttribute('data-collapsed', String(options.collapsed ?? false));
  link.setAttribute('data-collapsible', String(options.collapsible ?? false));
  if (typeof options.title === 'string') link.title = options.title;
  if (extras.verticalAlign) link.setAttribute('data-vertical-align', extras.verticalAlign);
  if (extras.verticalAlign) link.style.verticalAlign = extras.verticalAlign;
  if (typeof options.width === 'number') link.style.width = `${options.width}${units}`;
  if (typeof options.height === 'number') link.style.height = `${options.height}${units}`;
  if (extras.border) link.style.border = extras.border;
  if (extras.borderRadius) link.style.borderRadius = extras.borderRadius;

  const container = doc.createElement('span');
  container.className = 'gloss-image-container';
  const img = doc.createElement('img');
  img.className = 'gloss-image';
  img.alt = options.alt ?? '';
  img.draggable = false;
  if (typeof options.width === 'number') img.style.width = `${options.width}${units}`;
  if (typeof options.height === 'number') img.style.height = `${options.height}${units}`;
  container.appendChild(img);
  link.appendChild(container);

  if (options.description) {
    const desc = doc.createElement('span');
    desc.className = 'gloss-image-description';
    desc.textContent = options.description;
    link.appendChild(desc);
  }

  void ctx.resolveAsset(path).then((url) => {
    if (url) {
      img.src = url;
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.setAttribute('data-missing', 'true');
      img.alt = options.alt ?? path;
    }
  });
  return link;
}

/** Extracts the lookup term from an internal link, or null for external links. */
export function internalLinkTerm(href: string): string | null {
  if (href.startsWith('?')) {
    const params = new URLSearchParams(href.slice(1));
    const q = params.get('query');
    return q !== null && q.length > 0 ? q : null;
  }
  if (href.startsWith('ace-lookup:')) {
    const term = href.slice('ace-lookup:'.length);
    try {
      return decodeURIComponent(term);
    } catch {
      return term;
    }
  }
  return null;
}

/** Delegated click handler for internal links inside a rendered container. */
export function attachLinkHandler(root: HTMLElement, ctx: RenderContext): void {
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const anchor = target?.closest?.(`a[${LOOKUP_ATTRIBUTE}]`);
    if (!anchor || !root.contains(anchor)) return;
    const term = anchor.getAttribute(LOOKUP_ATTRIBUTE);
    if (!term) return;
    event.preventDefault();
    event.stopPropagation();
    ctx.onLookup?.(term);
  });
}
