/**
 * Newline-delimited JSON helpers that work on web streams (browser, Node, Bun).
 */

/** Yields each non-empty line of a UTF-8 byte stream. */
export async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8');
  const reader = stream.getReader();
  let carry = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      let nl = carry.indexOf('\n');
      while (nl !== -1) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        if (line.length > 0) yield line;
        nl = carry.indexOf('\n');
      }
    }
    carry += decoder.decode();
    if (carry.length > 0) yield carry;
  } finally {
    reader.releaseLock();
  }
}

/** Yields each parsed JSON line of a UTF-8 byte stream. */
export async function* readJsonLines<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  for await (const line of readLines(stream)) {
    yield JSON.parse(line) as T;
  }
}

/** Parses a whole JSONL text into an array. */
export function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

/** Serializes rows into JSONL text (trailing newline included). */
export function toJsonl(rows: readonly unknown[]): string {
  let s = '';
  for (const row of rows) s += `${JSON.stringify(row)}\n`;
  return s;
}
