/**
 * Background Anki service: builds notes from the popup's note data using the configured field
 * templates, checks for duplicates, stores media and adds notes through AnkiConnect.
 */
import {
  ANKI_STYLESHEET_PREFIX,
  type AnkiCheckResult,
  type AnkiMarkerContext,
  type AnkiMediaFile,
  type AnkiNoteData,
  type AnkiStatus,
  ankiDuplicateQuery,
  buildAnkiFields,
  getActiveProfile,
  type Settings,
} from '@acetylcholine/shared';
import { AnkiConnectClient, type AnkiConnectOptions } from './client.ts';

/** The part of the client the service uses (a fake stands in for tests). */
export type AnkiClientLike = Pick<
  AnkiConnectClient,
  | 'requestPermission'
  | 'deckNames'
  | 'modelNames'
  | 'modelFieldNames'
  | 'findNotes'
  | 'addNote'
  | 'storeMediaFile'
  | 'guiBrowse'
>;

/** First-field values longer than this are not searched for duplicates (the query would be the whole glossary). */
const MAX_DUPLICATE_QUERY_VALUE = 500;
const DUPLICATE_CACHE_MS = 30_000;

export class AnkiService {
  private client: AnkiClientLike | null = null;
  private clientKey = '';
  private readonly fieldNames = new Map<string, Promise<string[]>>();
  private readonly duplicates = new Map<string, { at: number; ids: number[] }>();
  /** `filename|size` of dictionary stylesheets already stored in Anki's media folder. */
  private readonly storedStylesheets = new Set<string>();

  constructor(
    private readonly getSettings: () => Promise<Settings>,
    private readonly createClient: (options: AnkiConnectOptions) => AnkiClientLike = (o) =>
      new AnkiConnectClient(o),
  ) {}

  /** Forgets the client and every cache (after a settings change). */
  invalidate(): void {
    this.client = null;
    this.clientKey = '';
    this.fieldNames.clear();
    this.duplicates.clear();
    this.storedStylesheets.clear();
  }

  private async connection(): Promise<{ client: AnkiClientLike; settings: Settings }> {
    const settings = await this.getSettings();
    const key = `${settings.anki.url}|${settings.anki.key}`;
    if (!this.client || this.clientKey !== key) {
      this.client = this.createClient({ url: settings.anki.url, key: settings.anki.key });
      this.clientKey = key;
      this.fieldNames.clear();
      this.duplicates.clear();
    }
    return { client: this.client, settings };
  }

  async status(): Promise<AnkiStatus> {
    const settings = await this.getSettings();
    const anki = settings.anki;
    const configured =
      anki.deck.length > 0 &&
      anki.model.length > 0 &&
      Object.values(anki.fields).some((t) => t.trim().length > 0);
    if (!anki.enabled) return { enabled: false, configured, connected: false };
    try {
      const { client } = await this.connection();
      const permission = await client.requestPermission();
      if (permission.permission !== 'granted') {
        return {
          enabled: true,
          configured,
          connected: false,
          permission: 'denied',
          error:
            'AnkiConnect refused this extension. Allow it in the dialog Anki shows, or add the origin to webCorsOriginList in the AnkiConnect config.',
        };
      }
      return {
        enabled: true,
        configured,
        connected: true,
        permission: 'granted',
        version: permission.version,
      };
    } catch (err) {
      return {
        enabled: true,
        configured,
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async decks(): Promise<string[]> {
    const { client } = await this.connection();
    return client.deckNames();
  }

  async models(): Promise<string[]> {
    const { client } = await this.connection();
    return client.modelNames();
  }

  async modelFields(model: string): Promise<string[]> {
    const { client } = await this.connection();
    let p = this.fieldNames.get(model);
    if (!p) {
      p = client.modelFieldNames(model);
      p.catch(() => this.fieldNames.delete(model));
      this.fieldNames.set(model, p);
    }
    return p;
  }

  private markerContext(note: AnkiNoteData, settings: Settings): AnkiMarkerContext {
    const profile =
      (note.profileId && settings.profiles.find((p) => p.id === note.profileId)) ||
      getActiveProfile(settings);
    return { readingTags: profile.readingTags, glossaryStyles: settings.anki.glossaryStyles };
  }

  /** Can each note be added, and which existing notes would it duplicate? */
  async check(notes: readonly AnkiNoteData[]): Promise<AnkiCheckResult[]> {
    const { client, settings } = await this.connection();
    const anki = settings.anki;
    if (!anki.enabled || !anki.deck || !anki.model) {
      return notes.map(() => ({ canAdd: false, noteIds: [], reason: 'Anki is not set up.' }));
    }
    const fieldNames = await this.modelFields(anki.model);
    const first = fieldNames[0];
    const out: AnkiCheckResult[] = [];
    for (const note of notes) {
      const fields = buildAnkiFields(anki.fields, note, this.markerContext(note, settings));
      const value = first ? fields[first] : undefined;
      if (!first || !value) {
        out.push({
          canAdd: false,
          noteIds: [],
          reason: first
            ? `The first field (${first}) would be empty; Anki needs it filled.`
            : 'The note type has no fields.',
        });
        continue;
      }
      if (!anki.checkDuplicates || value.length > MAX_DUPLICATE_QUERY_VALUE) {
        out.push({ canAdd: true, noteIds: [] });
        continue;
      }
      const query = ankiDuplicateQuery({
        model: anki.model,
        field: first,
        value,
        deck: anki.duplicateScope === 'deck' ? anki.deck : undefined,
      });
      const cached = this.duplicates.get(query);
      let ids: number[];
      if (cached && Date.now() - cached.at < DUPLICATE_CACHE_MS) {
        ids = cached.ids;
      } else {
        ids = await client.findNotes(query);
        this.duplicates.set(query, { at: Date.now(), ids });
      }
      out.push({ canAdd: ids.length === 0 || anki.allowDuplicates, noteIds: ids });
    }
    return out;
  }

  /** Stores the media, then adds the note; returns the new note id. */
  async add(note: AnkiNoteData, media: readonly AnkiMediaFile[]): Promise<{ noteId: number }> {
    const { client, settings } = await this.connection();
    const anki = settings.anki;
    if (!anki.enabled) throw new Error('Anki integration is disabled.');
    if (!anki.deck || !anki.model)
      throw new Error('Choose a deck and a note type in the settings.');
    const fields = buildAnkiFields(anki.fields, note, this.markerContext(note, settings));
    if (Object.keys(fields).length === 0) throw new Error('No field template is set.');
    for (const file of media) {
      const stylesheet = file.filename.startsWith(ANKI_STYLESHEET_PREFIX);
      if (stylesheet) {
        if (!anki.glossaryStyles) continue;
        // The same stylesheet is sent with every note: store it once per session.
        const key = `${file.filename}|${file.data.length}`;
        if (this.storedStylesheets.has(key)) continue;
        await client.storeMediaFile(file.filename, file.data);
        this.storedStylesheets.add(key);
        continue;
      }
      await client.storeMediaFile(file.filename, file.data);
    }
    const noteId = await client.addNote({
      deckName: anki.deck,
      modelName: anki.model,
      fields,
      tags: anki.tags,
      options: {
        allowDuplicate: anki.allowDuplicates,
        duplicateScope: anki.duplicateScope,
      },
    });
    this.duplicates.clear();
    return { noteId };
  }

  async view(noteIds: readonly number[]): Promise<void> {
    const { client } = await this.connection();
    await client.guiBrowse(`nid:${noteIds.join(',')}`);
  }
}
