import { createWriteStream, openAsBlob } from 'node:fs';
import { Writable } from 'node:stream';

declare const Bun: { file(path: string): Blob } | undefined;

/** Opens a file as a lazily-read Blob (works on Bun and Node ≥ 20). */
export async function openFileBlob(path: string): Promise<Blob> {
  if (typeof Bun !== 'undefined') return Bun.file(path);
  return openAsBlob(path);
}

/** Creates a web WritableStream that writes to a file. */
export function createFileSink(path: string): WritableStream<Uint8Array> {
  const stream = createWriteStream(path);
  return Writable.toWeb(stream) as WritableStream<Uint8Array>;
}
