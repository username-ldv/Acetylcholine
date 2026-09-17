/**
 * Fast 64-bit-ish string hash (two independent 32-bit FNV-1a/xorshift mixes over UTF-16 code
 * units), returned as 16 hex characters. Not cryptographic; used for ids and de-duplication.
 */
export function hash64(input: string): string {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9e3779b9 | 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + 0x7f4a7c15), 0x85ebca6b);
    h2 ^= h2 >>> 13;
  }
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x7feb352d);
  h1 ^= h1 >>> 15;
  h2 ^= h2 >>> 16;
  h2 = Math.imul(h2, 0x846ca68b);
  h2 ^= h2 >>> 16;
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** ASCII-only slug of a title; may be empty for non-Latin titles. */
export function asciiSlug(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/** Builds a stable dictionary id from a source format and title. */
export function makeDictionaryId(format: string, title: string): string {
  const slug = asciiSlug(title);
  const hash = hash64(title).slice(0, 12);
  return slug ? `${format}:${slug}-${hash}` : `${format}:${hash}`;
}

/** Normalizes a lookup key: NFC and trimmed. */
export function normalizeKey(key: string): string {
  return key.normalize('NFC').trim();
}

/** Zero-padded chunk file name, e.g. `entries/00001.jsonl`. */
export function chunkName(dir: string, index: number): string {
  return `${dir}/${String(index).padStart(5, '0')}.jsonl`;
}

/** Flattens structured content / html-ish content into plain text (best effort). */
export function structuredContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(structuredContentToText).join('');
  if (content && typeof content === 'object') {
    const node = content as { tag?: string; content?: unknown };
    if (node.tag === 'br') return '\n';
    const inner = node.content === undefined ? '' : structuredContentToText(node.content);
    if (node.tag === 'div' || node.tag === 'li' || node.tag === 'tr') return `${inner}\n`;
    return inner;
  }
  return '';
}
