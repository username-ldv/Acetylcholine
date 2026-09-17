/**
 * Renders `html` content blocks (MDX dictionaries) after sanitizing with DOMPurify. Unknown custom
 * elements (`<hw>`, `<x-pr>`, …) are kept because dictionary stylesheets target them; scripts,
 * external resources and event handlers are removed. `ace-asset:` references are resolved to blob
 * URLs and `ace-lookup:` links become nested lookups.
 */
import DOMPurify from 'dompurify';
import {
  attachLinkHandler,
  internalLinkTerm,
  LOOKUP_ATTRIBUTE,
  type RenderContext,
} from './structured.ts';

const FORBIDDEN_TAGS = new Set([
  'script',
  'style',
  'link',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'template',
  'noscript',
  'math',
  'svg',
]);

export const ACE_URI_REGEXP =
  /^(?:(?:https?|mailto|tel|data|blob|ace-asset|ace-lookup|sound):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const TAG_NAME_RE = /<\/?([a-zA-Z][\w:-]*)/g;

/** Every tag name used by a snippet, so custom elements can be allow-listed. */
export function collectTagNames(html: string): string[] {
  const names = new Set<string>();
  for (const m of html.matchAll(TAG_NAME_RE)) {
    const name = m[1]!.toLowerCase();
    if (!FORBIDDEN_TAGS.has(name)) names.add(name);
  }
  return [...names];
}

export interface SanitizedHtml {
  fragment: DocumentFragment;
}

/** Sanitizes HTML into a document fragment owned by `doc`. */
export function sanitizeHtml(html: string, doc: Document = document): DocumentFragment {
  const purifier = getPurifier(doc);
  return purifier.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: collectTagNames(html),
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    ADD_ATTR: ['target'],
    ALLOWED_URI_REGEXP: ACE_URI_REGEXP,
    ALLOW_DATA_ATTR: true,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: /^[a-z][\w-]*$/i,
      attributeNameCheck: /^[a-z][\w-]*$/i,
      allowCustomizedBuiltInElements: false,
    },
  }) as DocumentFragment;
}

const purifiers = new WeakMap<Document, ReturnType<typeof DOMPurify>>();

function getPurifier(doc: Document): ReturnType<typeof DOMPurify> {
  let p = purifiers.get(doc);
  if (!p) {
    p = DOMPurify((doc.defaultView ?? globalThis) as unknown as Parameters<typeof DOMPurify>[0]);
    purifiers.set(doc, p);
  }
  return p;
}

/** Renders an `html` content block. */
export function renderHtml(html: string, ctx: RenderContext): HTMLElement {
  const doc = ctx.document ?? document;
  const root = doc.createElement('div');
  root.className = 'ace-html';
  root.appendChild(sanitizeHtml(html, doc));
  rewriteHtmlReferences(root, ctx);
  attachLinkHandler(root, ctx);
  return root;
}

const ASSET_PREFIX = 'ace-asset:';

/** Resolves `ace-asset:` sources and turns `ace-lookup:` anchors into internal lookup links. */
export function rewriteHtmlReferences(root: HTMLElement, ctx: RenderContext): void {
  for (const el of root.querySelectorAll<HTMLElement>('[src],[href],[poster]')) {
    for (const attr of ['src', 'href', 'poster'] as const) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      if (value.startsWith(ASSET_PREFIX)) {
        const path = decodePath(value.slice(ASSET_PREFIX.length));
        el.removeAttribute(attr);
        void ctx.resolveAsset(path).then((url) => {
          if (url) el.setAttribute(attr, url);
          else el.setAttribute('data-missing', 'true');
        });
      } else if (attr === 'href' && el instanceof HTMLAnchorElement) {
        const term = internalLinkTerm(value);
        if (term !== null) {
          el.setAttribute('href', '#');
          el.setAttribute(LOOKUP_ATTRIBUTE, term);
        } else if (/^https?:\/\//i.test(value)) {
          el.target = '_blank';
          el.rel = 'noopener noreferrer';
        }
      }
    }
  }
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
