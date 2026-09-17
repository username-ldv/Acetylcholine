/**
 * Text extraction under the cursor: caret position → text node + offset → up to N characters
 * forward across inline siblings, with a Range for any prefix (used for highlighting).
 */

export interface CaretHit {
  node: Text;
  offset: number;
}

export interface TextSegment {
  node: Text;
  start: number;
  end: number;
}

export interface ScannedText {
  text: string;
  segments: TextSegment[];
}

const BLOCK_DISPLAY = new Set([
  'block',
  'flex',
  'grid',
  'list-item',
  'table',
  'table-row',
  'table-cell',
  'table-caption',
  'flow-root',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'inline-table',
]);

const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'SVG',
]);

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

type DocumentWithCaret = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/** Text node and offset at a viewport point, or null when the point is not over text. */
export function caretFromPoint(x: number, y: number, doc: Document = document): CaretHit | null {
  const d = doc as DocumentWithCaret;
  let node: Node | null = null;
  let offset = 0;
  if (typeof d.caretPositionFromPoint === 'function') {
    const pos = d.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof d.caretRangeFromPoint === 'function') {
    const range = d.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    return null;
  }
  if (!node) return null;
  if (node.nodeType === Node.ELEMENT_NODE) {
    // The caret landed between children; pick the child text node at that index, if any.
    const child = node.childNodes[offset] ?? node.childNodes[offset - 1];
    if (!child || child.nodeType !== Node.TEXT_NODE) return null;
    node = child;
    offset = 0;
  }
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node as Text;
  if (!isScannableTextNode(text)) return null;
  // Caret offsets are boundaries; we want the character under the cursor.
  const len = text.data.length;
  if (len === 0) return null;
  if (offset >= len) offset = len - 1;
  return { node: text, offset: snapToCharacter(text, offset, x, y) };
}

/**
 * The caret snaps to the nearest boundary, which for the right half of a glyph is the *next*
 * character. Check both neighbours and keep whichever glyph contains the point.
 */
function snapToCharacter(node: Text, offset: number, x: number, y: number): number {
  if (isPointInCharacter(node, offset, x, y)) return offset;
  if (offset > 0 && isPointInCharacter(node, offset - 1, x, y)) return offset - 1;
  return offset;
}

const range = typeof document !== 'undefined' ? document.createRange() : null;

/** True when the viewport point lies within the glyph box of the character at `offset`. */
export function isPointInCharacter(node: Text, offset: number, x: number, y: number): boolean {
  if (!range || offset < 0 || offset >= node.data.length) return false;
  // Do not split a surrogate pair.
  const code = node.data.charCodeAt(offset);
  const end = code >= 0xd800 && code <= 0xdbff ? offset + 2 : offset + 1;
  range.setStart(node, offset);
  range.setEnd(node, Math.min(end, node.data.length));
  for (const rect of range.getClientRects()) {
    if (rect.width === 0 && rect.height === 0) continue;
    if (x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1) {
      return true;
    }
  }
  return false;
}

export function isScannableTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (parent.closest('script,style,noscript,textarea,select,svg')) return false;
  if (node.data.trim().length === 0) return false;
  return true;
}

/** Nearest ancestor that starts a new line (block formatting), used to bound extraction. */
export function blockAncestor(node: Node): Element | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  while (el) {
    if (el.tagName === 'BR' || el.tagName === 'BODY' || el.tagName === 'HTML') return el;
    const display = el.ownerDocument.defaultView?.getComputedStyle(el).display ?? 'inline';
    if (BLOCK_DISPLAY.has(display) || display.startsWith('table')) return el;
    el = el.parentElement;
  }
  return null;
}

/**
 * Extracts up to `maxChars` characters (code points) starting at the caret, continuing through
 * following text nodes inside the same block. Stops early when `isTextChar` rejects a character.
 */
export function extractText(
  hit: CaretHit,
  maxChars: number,
  isTextChar: (ch: string) => boolean,
  doc: Document = document,
): ScannedText {
  const block = blockAncestor(hit.node);
  const segments: TextSegment[] = [];
  let text = '';
  let count = 0;
  let stop = false;

  const consume = (node: Text, from: number): void => {
    const data = node.data;
    let i = from;
    const start = from;
    while (i < data.length && count < maxChars) {
      const code = data.charCodeAt(i);
      const size = code >= 0xd800 && code <= 0xdbff && i + 1 < data.length ? 2 : 1;
      const ch = data.slice(i, i + size);
      if (!isTextChar(ch)) {
        stop = true;
        break;
      }
      text += ch;
      count++;
      i += size;
    }
    if (i > start) segments.push({ node, start, end: i });
    if (count >= maxChars) stop = true;
  };

  consume(hit.node, hit.offset);
  if (stop) return { text, segments };

  const walker = doc.createTreeWalker(
    block ?? doc.body,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (SKIPPED_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.tagName === 'BR') return NodeFilter.FILTER_ACCEPT;
          const view = el.ownerDocument.defaultView;
          if (view) {
            const style = view.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') {
              return NodeFilter.FILTER_REJECT;
            }
            if (
              el !== block &&
              (BLOCK_DISPLAY.has(style.display) || style.display.startsWith('table'))
            ) {
              return NodeFilter.FILTER_ACCEPT; // a nested block ends the run
            }
          }
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );
  walker.currentNode = hit.node;
  while (!stop) {
    const next = walker.nextNode();
    if (!next) break;
    if (next.nodeType === Node.ELEMENT_NODE) break; // BR or nested block
    const t = next as Text;
    if (t.data.length === 0) continue;
    consume(t, 0);
  }
  return { text, segments };
}

/** Range covering the first `length` UTF-16 units of the scanned text. */
export function rangeForLength(
  scanned: ScannedText,
  length: number,
  doc: Document = document,
): Range | null {
  if (length <= 0 || scanned.segments.length === 0) return null;
  const r = doc.createRange();
  const first = scanned.segments[0]!;
  r.setStart(first.node, first.start);
  let remaining = length;
  for (const seg of scanned.segments) {
    const size = seg.end - seg.start;
    if (remaining <= size) {
      r.setEnd(seg.node, seg.start + remaining);
      return r;
    }
    remaining -= size;
    r.setEnd(seg.node, seg.end);
  }
  return r;
}
