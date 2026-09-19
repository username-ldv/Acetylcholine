/**
 * Parser for MDX text exports (`mdict-utils` / MdxBuilder source format):
 *
 *     key
 *     html … (any number of lines)
 *     </>
 *
 * Streams the input line by line, so memory use is bounded by the largest record.
 */
import type { MdxRecord } from './types.ts';

export type MdxTextSource = Blob | Uint8Array | string;

export async function* parseMdxTextExport(source: MdxTextSource): AsyncGenerator<MdxRecord> {
  let key: string | null = null;
  let body: string[] = [];
  let first = true;
  for await (let line of lines(source)) {
    if (first) {
      first = false;
      if (line.startsWith('﻿')) line = line.slice(1);
    }
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (key === null) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      key = trimmed;
      continue;
    }
    if (line.trim() === '</>') {
      yield { key, html: body.join('\n') };
      key = null;
      body = [];
      continue;
    }
    body.push(line);
  }
  if (key !== null && body.some((l) => l.trim().length > 0)) {
    yield { key, html: body.join('\n') };
  }
}

async function* lines(source: MdxTextSource): AsyncGenerator<string> {
  if (typeof source === 'string') {
    yield* source.split('\n');
    return;
  }
  if (source instanceof Uint8Array) {
    yield* new TextDecoder('utf-8').decode(source).split('\n');
    return;
  }
  const reader = source.stream().pipeThrough(new TextDecoderStream('utf-8')).getReader();
  let rest = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const parts = (rest + value).split('\n');
      rest = parts.pop() ?? '';
      yield* parts;
    }
  } finally {
    reader.releaseLock();
  }
  if (rest.length > 0) yield rest;
}
