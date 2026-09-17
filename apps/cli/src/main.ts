import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  AceReader,
  AceWriter,
  aceEntrySchema,
  aceKeySchema,
  structuredContentToText,
} from '@acetylcholine/ace';
import { type ConvertProgress, checkYomitanEditions, convertYomitan } from '@acetylcholine/convert';
import { configure } from '@zip.js/zip.js';
import { defineCommand, runMain } from 'citty';
import { consola } from 'consola';
import { createFileSink, openFileBlob } from './io.ts';

configure({ useWebWorkers: false });

const VERSION = '0.1.0';

function formatProgress(p: ConvertProgress): string {
  const src = p.source !== undefined ? `[src ${p.source + 1}] ` : '';
  const pass = p.pass ? `pass ${p.pass} ` : '';
  const file = p.file ? ` ${p.file}` : '';
  return `${src}${p.stage} ${pass}${p.current + 1}/${p.total}${file}`;
}

async function detectFormat(path: string): Promise<'yomitan' | 'mdx'> {
  const ext = extname(path).toLowerCase();
  if (ext === '.zip') return 'yomitan';
  if (ext === '.mdx') return 'mdx';
  const s = await stat(path);
  if (s.isDirectory()) return 'mdx';
  throw new Error(`Cannot detect the dictionary format of ${path}; pass --format`);
}

const convert = defineCommand({
  meta: { name: 'convert', description: 'Convert dictionaries into a .ace file' },
  args: {
    output: { type: 'string', alias: 'o', description: 'Output .ace path' },
    format: { type: 'string', default: 'auto', description: 'auto | yomitan | mdx' },
    title: { type: 'string', description: 'Override the dictionary title' },
    id: { type: 'string', description: 'Override the dictionary id' },
    'reading-tags': {
      type: 'string',
      description:
        'Comma-separated reading tag per input (e.g. pinyin,zhuyin); auto-detected otherwise',
    },
    'index-readings': {
      type: 'boolean',
      default: false,
      description: 'Make readings searchable keys',
    },
    merge: {
      type: 'boolean',
      default: true,
      description: 'Merge identical entries across rows/inputs',
    },
    level: { type: 'string', default: '6', description: 'Deflate level 0-9' },
    quiet: { type: 'boolean', default: false },
  },
  async run({ args }) {
    const inputs = args._.map((p) => resolve(String(p)));
    if (inputs.length === 0) throw new Error('At least one input file is required');
    const format = args.format === 'auto' ? await detectFormat(inputs[0]!) : args.format;
    const output = resolve(
      args.output ?? join(dirname(inputs[0]!), `${basename(inputs[0]!, extname(inputs[0]!))}.ace`),
    );
    const level = Number.parseInt(args.level, 10);
    const readingTags = args['reading-tags']
      ? args['reading-tags'].split(',').map((s) => s.trim() || undefined)
      : undefined;

    consola.info(`Converting ${inputs.length} ${format} input(s) → ${output}`);
    const started = performance.now();
    const writer = new AceWriter({
      sink: createFileSink(output),
      compressionLevel: Number.isFinite(level) ? level : 6,
      generator: `acetylcholine-cli/${VERSION}`,
    });
    let lastLine = '';
    const onProgress = (p: ConvertProgress) => {
      if (args.quiet) return;
      const line = formatProgress(p);
      if (line !== lastLine) {
        consola.log(`  ${line}`);
        lastLine = line;
      }
    };

    if (format === 'yomitan') {
      const blobs: Blob[] = [];
      for (const p of inputs) blobs.push(await openFileBlob(p));
      const { manifest } = await convertYomitan(blobs, writer, {
        indexReadings: args['index-readings'],
        merge: args.merge,
        readingTags,
        title: args.title,
        id: args.id,
        generator: `acetylcholine-cli/${VERSION}`,
        onProgress,
        onWarning: (message) => consola.warn(message),
      });
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const size = (await stat(output)).size;
      consola.success(
        `Wrote ${output} (${(size / 1024 / 1024).toFixed(1)} MiB) in ${seconds}s — ` +
          `${manifest.counts.entries} entries, ${manifest.counts.keys} keys, ` +
          `${manifest.counts.assets} assets, reading tags: ${manifest.readingTags.join(', ') || 'none'}`,
      );
    } else if (format === 'mdx') {
      throw new Error('MDX conversion is not implemented yet (planned in Phase 4)');
    } else {
      throw new Error(`Unknown format "${format}"`);
    }
  },
});

const inspect = defineCommand({
  meta: { name: 'inspect', description: 'Show the manifest of a .ace file' },
  args: {
    file: { type: 'positional', required: true, description: 'Path to a .ace file' },
    validate: { type: 'boolean', default: false, description: 'Validate every entry and key' },
    json: { type: 'boolean', default: false, description: 'Print the raw manifest as JSON' },
  },
  async run({ args }) {
    const reader = await AceReader.open(await openFileBlob(resolve(args.file)));
    try {
      const m = reader.manifest;
      if (args.json) {
        console.log(JSON.stringify(m, null, 2));
      } else {
        consola.box(
          [
            `${m.title}  (rev ${m.revision})`,
            `id: ${m.id}`,
            `source: ${m.source.format}   languages: ${m.sourceLanguage ?? '?'} → ${m.targetLanguage ?? '?'}`,
            `reading tags: ${m.readingTags.join(', ') || 'none'}   content kinds: ${m.contentKinds.join(', ')}`,
            `entries: ${m.counts.entries}   keys: ${m.counts.keys}   meta: ${m.counts.meta}   tags: ${m.counts.tags}`,
            `kanji: ${m.counts.kanji}   kanji meta: ${m.counts.kanjiMeta}   assets: ${m.counts.assets}`,
            `chunks: ${m.files.entries.length} entry / ${m.files.keys.length} key   styles: ${m.files.styles ? 'yes' : 'no'}`,
            `generator: ${m.generator}   created: ${m.createdAt}`,
          ].join('\n'),
        );
      }
      if (args.validate) {
        let entries = 0;
        let lastId = -1;
        const ids = new Set<number>();
        for await (const entry of reader.entries()) {
          const res = aceEntrySchema.safeParse(entry);
          if (!res.success) throw new Error(`Invalid entry ${entry.id}: ${res.error.message}`);
          if (entry.id <= lastId) throw new Error(`Entry ids not ascending at ${entry.id}`);
          lastId = entry.id;
          ids.add(entry.id);
          entries++;
        }
        let keys = 0;
        for await (const key of reader.keys()) {
          const res = aceKeySchema.safeParse(key);
          if (!res.success)
            throw new Error(`Invalid key ${JSON.stringify(key)}: ${res.error.message}`);
          if (!ids.has(key[1])) throw new Error(`Key ${key[0]} points to missing entry ${key[1]}`);
          keys++;
        }
        if (entries !== m.counts.entries || keys !== m.counts.keys) {
          throw new Error(
            `Counts mismatch: manifest says ${m.counts.entries}/${m.counts.keys}, found ${entries}/${keys}`,
          );
        }
        for (const asset of m.files.assets) {
          if (!reader.hasAsset(asset)) throw new Error(`Missing asset ${asset}`);
        }
        consola.success(`Valid: ${entries} entries, ${keys} keys, ${m.files.assets.length} assets`);
      }
    } finally {
      await reader.close();
    }
  },
});

const lookup = defineCommand({
  meta: { name: 'lookup', description: 'Find entries for exact keys (slow scan, for debugging)' },
  args: {
    file: { type: 'positional', required: true, description: 'Path to a .ace file' },
    json: { type: 'boolean', default: false, description: 'Print entries as JSON' },
  },
  async run({ args }) {
    const terms = args._.slice(1).map(String);
    if (terms.length === 0) throw new Error('Give at least one term to look up');
    const reader = await AceReader.open(await openFileBlob(resolve(args.file)));
    try {
      for (const term of terms) {
        const hits = await reader.findEntries(term);
        if (args.json) {
          console.log(JSON.stringify({ term, hits }, null, 2));
          continue;
        }
        consola.info(`${term}: ${hits.length} entr${hits.length === 1 ? 'y' : 'ies'}`);
        for (const { entry, kinds } of hits) {
          const readings = entry.readings
            .map((r) => `${r.text}${r.tags.length ? ` [${r.tags.join(',')}]` : ''}`)
            .join(' / ');
          console.log(
            `  #${entry.id}  ${entry.headwords.join(' | ')}  ${readings}  (key kinds: ${kinds.join(',')})`,
          );
          for (const block of entry.content) {
            let text: string;
            switch (block.type) {
              case 'text':
                text = block.text;
                break;
              case 'structured':
                text = structuredContentToText(block.content);
                break;
              case 'html':
                text = block.html.replace(/<[^>]+>/g, '');
                break;
              case 'image':
                text = `[image ${block.path}]`;
                break;
              case 'deinflection':
                text = `[deinflection → ${block.term}]`;
                break;
            }
            const flat = text.replace(/\s+/g, ' ').trim();
            console.log(`      ${flat.length > 300 ? `${flat.slice(0, 300)}…` : flat}`);
          }
        }
      }
    } finally {
      await reader.close();
    }
  },
});

const check = defineCommand({
  meta: {
    name: 'check',
    description:
      'Check Yomitan zips against the .ace conventions (sequenced, no empty terms, reading tags, identical content across editions)',
  },
  args: {
    json: { type: 'boolean', default: false, description: 'Print the report as JSON' },
  },
  async run({ args }) {
    const inputs = args._.map((p) => resolve(String(p)));
    if (inputs.length === 0) throw new Error('Give at least one Yomitan zip');
    const blobs: Blob[] = [];
    for (const p of inputs) blobs.push(await openFileBlob(p));
    const report = await checkYomitanEditions(blobs);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    let problems = 0;
    report.editions.forEach((e, i) => {
      consola.info(`${basename(inputs[i]!)} — ${e.title} (rev ${e.revision}, format ${e.format})`);
      console.log(
        `    rows: ${e.rows}   sequenced: ${e.sequenced}   distinct sequences: ${e.distinctSequences}   shared: ${e.sharedSequences}`,
      );
      console.log(
        `    empty terms: ${e.emptyTerms}   rows with reading-tag: ${e.rowsWithReadingTag}   css reading-tag rules: ${e.readingTagCssSelectors.join(' | ') || 'none'}`,
      );
      if (!e.sequenced) {
        problems++;
        consola.warn('    not sequenced: rows of one entry cannot be grouped generically');
      }
      if (e.emptyTerms > 0) {
        problems++;
        consola.warn(`    ${e.emptyTerms} row(s) have an empty term`);
      }
    });
    report.comparisons.forEach((c, i) => {
      const name = basename(inputs[i + 1]!);
      if (c.aligned && c.contentDiffers === 0) {
        consola.success(`${name}: identical to the first edition except for readings`);
        return;
      }
      problems++;
      consola.warn(
        `${name}: aligned=${c.aligned} rowCountsMatch=${c.rowCountsMatch} termDiffers=${c.termDiffers} sequenceDiffers=${c.sequenceDiffers} contentDiffers=${c.contentDiffers}` +
          (c.contentDiffExamples.length ? `  e.g. ${c.contentDiffExamples.join(', ')}` : ''),
      );
    });
    if (problems === 0) consola.success('All checks passed');
    else process.exitCode = 1;
  },
});

const main = defineCommand({
  meta: {
    name: 'ace',
    version: VERSION,
    description: 'Acetylcholine dictionary tool: convert, inspect and query .ace files',
  },
  subCommands: { convert, inspect, lookup, check },
});

runMain(main);
