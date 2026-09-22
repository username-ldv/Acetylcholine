/**
 * Minimal AnkiConnect client (API version 6): one POST per action, JSON in and out.
 * https://git.sr.ht/~foosoft/anki-connect
 */

export interface AnkiConnectOptions {
  url: string;
  /** `apiKey` from the AnkiConnect config; omitted when empty. */
  key?: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export type AnkiConnectErrorKind = 'network' | 'timeout' | 'http' | 'anki';

export class AnkiConnectError extends Error {
  constructor(
    message: string,
    readonly kind: AnkiConnectErrorKind,
  ) {
    super(message);
    this.name = 'AnkiConnectError';
  }
}

export interface AnkiConnectNoteOptions {
  allowDuplicate?: boolean;
  duplicateScope?: 'collection' | 'deck';
  duplicateScopeOptions?: {
    deckName?: string | null;
    checkChildren?: boolean;
    checkAllModels?: boolean;
  };
}

export interface AnkiConnectNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags: string[];
  options?: AnkiConnectNoteOptions;
}

export interface AnkiPermission {
  permission: 'granted' | 'denied';
  requireApikey?: boolean;
  version?: number;
}

export class AnkiConnectClient {
  private readonly url: string;
  private readonly key: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AnkiConnectOptions) {
    this.url = options.url;
    this.key = options.key || undefined;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    // Bound: calling the native `fetch` as a method of this object is an "Illegal invocation".
    this.fetchImpl = (options.fetch ?? fetch).bind(globalThis);
  }

  async invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body: Record<string, unknown> = { action, version: 6, params };
    if (this.key !== undefined) body.key = this.key;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new AnkiConnectError(
          `AnkiConnect did not answer within ${this.timeoutMs} ms`,
          'timeout',
        );
      }
      throw new AnkiConnectError(
        `Cannot reach AnkiConnect at ${this.url}. Is Anki running with the AnkiConnect add-on? (${
          err instanceof Error ? err.message : String(err)
        })`,
        'network',
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new AnkiConnectError(`AnkiConnect answered HTTP ${response.status}`, 'http');
    }
    let json: { result?: T; error?: string | null };
    try {
      json = (await response.json()) as { result?: T; error?: string | null };
    } catch {
      throw new AnkiConnectError('AnkiConnect answered with something that is not JSON', 'http');
    }
    if (json.error) throw new AnkiConnectError(json.error, 'anki');
    return json.result as T;
  }

  version(): Promise<number> {
    return this.invoke<number>('version');
  }

  /**
   * Asks AnkiConnect to allow this origin (it shows a dialog inside Anki the first time an
   * unknown origin asks). Always answered, even from origins not yet allowed.
   */
  requestPermission(): Promise<AnkiPermission> {
    return this.invoke<AnkiPermission>('requestPermission');
  }

  deckNames(): Promise<string[]> {
    return this.invoke<string[]>('deckNames');
  }

  modelNames(): Promise<string[]> {
    return this.invoke<string[]>('modelNames');
  }

  modelFieldNames(modelName: string): Promise<string[]> {
    return this.invoke<string[]>('modelFieldNames', { modelName });
  }

  findNotes(query: string): Promise<number[]> {
    return this.invoke<number[]>('findNotes', { query });
  }

  addNote(note: AnkiConnectNote): Promise<number> {
    return this.invoke<number>('addNote', { note });
  }

  /** Stores a file in the media folder; returns the file name actually used. */
  storeMediaFile(filename: string, base64: string): Promise<string> {
    return this.invoke<string>('storeMediaFile', { filename, data: base64 });
  }

  /** Opens the Anki card browser on a search; returns the matching card ids. */
  guiBrowse(query: string): Promise<number[]> {
    return this.invoke<number[]>('guiBrowse', { query });
  }
}
