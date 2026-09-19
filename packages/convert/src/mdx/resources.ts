/**
 * Resolves the file references found in MDX HTML and CSS (`src="001.PNG"`, `url('hei.ttf')`,
 * `\HYGF2.css`) against the names a resource store actually has.
 */

/** Forward slashes, no `file://`, no leading `./` or `/`, percent-decoded, NFC. */
export function normalizeResourceName(name: string): string {
  let n = name.normalize('NFC').replace(/\\/g, '/').trim();
  try {
    n = decodeURIComponent(n);
  } catch {
    // keep as is
  }
  n = n.replace(/^file:\/+/i, '');
  while (n.startsWith('./')) n = n.slice(2);
  while (n.startsWith('/')) n = n.slice(1);
  return n;
}

export class ResourceIndex {
  /** normalized name → name as stored */
  private readonly raw = new Map<string, string>();
  /** lower-cased normalized name → normalized name */
  private readonly lower = new Map<string, string>();
  /** lower-cased base name → normalized name, or null when ambiguous */
  private readonly base = new Map<string, string | null>();

  constructor(names: Iterable<string>) {
    for (const name of names) {
      const normalized = normalizeResourceName(name);
      if (normalized.length === 0 || this.raw.has(normalized)) continue;
      this.raw.set(normalized, name);
      const lc = normalized.toLowerCase();
      if (!this.lower.has(lc)) this.lower.set(lc, normalized);
      const baseName = lc.slice(lc.lastIndexOf('/') + 1);
      this.base.set(baseName, this.base.has(baseName) ? null : normalized);
    }
  }

  get size(): number {
    return this.raw.size;
  }

  /** All normalized names. */
  names(): string[] {
    return [...this.raw.keys()];
  }

  /** The store's own name for a normalized name. */
  rawName(normalized: string): string | undefined {
    return this.raw.get(normalized);
  }

  /**
   * Normalized name of the resource a reference points to: exact match, then case-insensitive,
   * then by base name when that is unambiguous (dictionaries often write `img/x.png` for a
   * resource stored as `\x.png`, or vice versa).
   */
  resolve(ref: string): string | null {
    let n = normalizeResourceName(ref);
    const cut = n.search(/[?#]/);
    if (cut >= 0) n = n.slice(0, cut);
    if (n.length === 0) return null;
    if (this.raw.has(n)) return n;
    const lc = n.toLowerCase();
    const byLower = this.lower.get(lc);
    if (byLower !== undefined) return byLower;
    const byBase = this.base.get(lc.slice(lc.lastIndexOf('/') + 1));
    return byBase ?? null;
  }
}
