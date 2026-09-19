/** One MDX record: the lookup key and its HTML body (or an `@@@LINK=` redirect). */
export interface MdxRecord {
  key: string;
  html: string;
}

/**
 * Files a dictionary can reference: the `.mdd` contents plus sidecar files (CSS, JS, fonts,
 * images) that ship next to the `.mdx`. Names are as stored; the converter normalizes them.
 */
export interface MdxResourceStore {
  list(): string[];
  get(name: string): Promise<Uint8Array | null>;
}

/** An MDX dictionary abstracted over its container (text export, raw `.mdx` + `.mdd`, …). */
export interface MdxSource {
  title?: string;
  description?: string;
  revision?: string;
  /** Total record count when cheaply known (progress reporting only). */
  recordCount?: number;
  /** Records in file order; iterated once. */
  records(): AsyncIterable<MdxRecord>;
  resources?: MdxResourceStore;
}
