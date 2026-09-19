/**
 * Node-side MDX inputs for the CLI: a `mdict-utils` text export folder (`*.mdx.txt` + `mdd/`) or
 * a raw `.mdx` (+ `.mdd`) read through js-mdict. Both become an environment-agnostic `MdxSource`
 * for `convertMdx`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { type MdxResourceStore, type MdxSource, parseMdxTextExport } from '@acetylcholine/convert';
import { type KeyWordItem, MDD, MDX } from 'js-mdict';
import { openFileBlob } from './io.ts';

/** Files next to the dictionary that its HTML/CSS may reference. */
const SIDECAR_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.mp3',
  '.ogg',
  '.wav',
  '.spx',
  '.m4a',
  '.opus',
]);

export interface MdxInput {
  kind: 'text-export' | 'mdx';
  /** Human-readable description of what was opened. */
  label: string;
  source: MdxSource;
}

/**
 * Opens a folder (text export with `mdx/*.mdx.txt` or `*.mdx.txt`, else a `*.mdx`), a
 * `.mdx.txt` file or a `.mdx` file.
 */
export async function openMdxInput(path: string): Promise<MdxInput> {
  const s = await stat(path);
  if (s.isDirectory()) {
    const txt = await findFile(path, ['', 'mdx'], (n) => n.toLowerCase().endsWith('.mdx.txt'));
    if (txt) return openTextExport(txt, path);
    const mdx = await findFile(path, [''], (n) => n.toLowerCase().endsWith('.mdx'));
    if (mdx) return openRawMdx(mdx);
    throw new Error(`${path}: no *.mdx.txt export or *.mdx file found`);
  }
  const lower = path.toLowerCase();
  if (lower.endsWith('.txt')) {
    const dir = dirname(path);
    const base = basename(dir).toLowerCase() === 'mdx' ? dirname(dir) : dir;
    return openTextExport(path, base);
  }
  if (lower.endsWith('.mdx')) return openRawMdx(path);
  throw new Error(`${path}: expected a folder, a .mdx.txt export or a .mdx file`);
}

async function findFile(
  dir: string,
  subdirs: string[],
  test: (name: string) => boolean,
): Promise<string | null> {
  for (const sub of subdirs) {
    const d = sub ? join(dir, sub) : dir;
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      continue;
    }
    const hit = names.filter(test).sort()[0];
    if (hit) return join(d, hit);
  }
  return null;
}

// ---- text export ----------------------------------------------------------------------------

async function openTextExport(txtPath: string, baseDir: string): Promise<MdxInput> {
  const stem = basename(txtPath).replace(/\.mdx\.txt$/i, '');
  const meta = async (suffix: string): Promise<string | undefined> => {
    try {
      const text = await readFile(join(dirname(txtPath), `${stem}.mdx.${suffix}.html`), 'utf8');
      return stripTags(text) || undefined;
    } catch {
      return undefined;
    }
  };
  const title = (await meta('title')) ?? stem;
  const description = await meta('description');
  const files = new Map<string, string>();
  await addTree(files, join(baseDir, 'mdd'), '');
  await addSidecars(files, baseDir);
  if (dirname(txtPath) !== baseDir) await addSidecars(files, dirname(txtPath));
  const blob = await openFileBlob(txtPath);
  return {
    kind: 'text-export',
    label: `text export ${txtPath} (${files.size} resource files)`,
    source: {
      title,
      description,
      records: () => parseMdxTextExport(blob),
      resources: fileStore(files),
    },
  };
}

/** Adds every file below `dir` (recursively) under its relative name. */
async function addTree(files: Map<string, string>, dir: string, prefix: string): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await addTree(files, join(dir, entry.name), name);
    else if (entry.isFile() && !files.has(name)) files.set(name, join(dir, entry.name));
  }
}

/** Adds CSS/JS/font/image/audio files lying directly in `dir`. */
async function addSidecars(files: Map<string, string>, dir: string): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !SIDECAR_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    if (!files.has(entry.name)) files.set(entry.name, join(dir, entry.name));
  }
}

function fileStore(files: Map<string, string>): MdxResourceStore {
  return {
    list: () => [...files.keys()],
    get: async (name) => {
      const path = files.get(name);
      if (!path) return null;
      return new Uint8Array(await readFile(path));
    },
  };
}

// ---- raw .mdx / .mdd --------------------------------------------------------------------------

async function openRawMdx(mdxPath: string): Promise<MdxInput> {
  const mdx = new MDX(mdxPath);
  const header = mdx.header as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === 'string' ? stripTags(v) : '');
  const stem = basename(mdxPath, extname(mdxPath));
  const dir = dirname(mdxPath);
  const title = text(header.Title) || stem;
  const description = text(header.Description) || undefined;

  // `<stem>.mdd` plus numbered parts `<stem>.1.mdd`, `<stem>.2.mdd`, …
  const mdds: MDD[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (!name.toLowerCase().endsWith('.mdd')) continue;
    const s = name.slice(0, -4);
    const part = s.startsWith(`${stem}.`) ? s.slice(stem.length + 1) : null;
    if (s === stem || (part !== null && /^\d+$/.test(part))) mdds.push(new MDD(join(dir, name)));
  }
  const mddItems = new Map<string, { mdd: MDD; item: KeyWordItem }>();
  for (const mdd of mdds) {
    for (const item of mdd.keywordList) {
      if (!mddItems.has(item.keyText)) mddItems.set(item.keyText, { mdd, item });
    }
  }
  const files = new Map<string, string>();
  await addSidecars(files, dir);

  const nul = String.fromCharCode(0);
  const source: MdxSource = {
    title,
    description,
    recordCount: mdx.keywordList.length,
    async *records() {
      for (const item of mdx.keywordList) {
        const { keyText, definition } = mdx.fetch(item);
        if (definition === null) continue;
        let html = definition;
        while (html.endsWith(nul)) html = html.slice(0, -1);
        yield { key: keyText, html };
      }
    },
    resources: {
      list: () => [...mddItems.keys(), ...files.keys()],
      get: async (name) => {
        const hit = mddItems.get(name);
        if (hit) return new Uint8Array(hit.mdd.lookupRecordByKeyBlock(hit.item));
        const path = files.get(name);
        return path ? new Uint8Array(await readFile(path)) : null;
      },
    },
  };
  return {
    kind: 'mdx',
    label: `${mdxPath} (${mdx.keywordList.length} records, ${mdds.length} .mdd file(s), ${files.size} sidecar files)`,
    source,
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
