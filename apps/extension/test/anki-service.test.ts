import { type AnkiNoteData, defaultSettings, type Settings } from '@acetylcholine/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnkiConnectNote } from '../src/lib/anki/client.ts';
import { type AnkiClientLike, AnkiService } from '../src/lib/anki/service.ts';

class FakeClient implements AnkiClientLike {
  calls: [string, unknown][] = [];
  notesByQuery = new Map<string, number[]>();
  nextId = 100;
  permission: 'granted' | 'denied' = 'granted';
  fail: string | null = null;

  private guard() {
    if (this.fail) throw new Error(this.fail);
  }
  async requestPermission() {
    this.guard();
    return { permission: this.permission, version: 6 };
  }
  async deckNames() {
    return ['Default', 'Acetylcholine Test'];
  }
  async modelNames() {
    return ['CN Mining'];
  }
  async modelFieldNames(model: string) {
    this.calls.push(['modelFieldNames', model]);
    return ['Word', 'Reading', 'Definition'];
  }
  async findNotes(query: string) {
    this.calls.push(['findNotes', query]);
    return this.notesByQuery.get(query) ?? [];
  }
  async addNote(note: AnkiConnectNote) {
    this.calls.push(['addNote', note]);
    return this.nextId++;
  }
  async storeMediaFile(filename: string, _data: string) {
    this.calls.push(['storeMediaFile', filename]);
    return filename;
  }
  async guiBrowse(query: string) {
    this.calls.push(['guiBrowse', query]);
    return [];
  }
}

const note: AnkiNoteData = {
  expression: '圖片',
  headwords: ['圖片', '图片'],
  readings: [
    { text: 'tú piàn', tags: ['pinyin'] },
    { text: 'ㄊㄨˊㄆㄧㄢˋ', tags: ['zhuyin'] },
  ],
  glossary: [{ dictionary: 'moe', title: '兩岸詞典', html: '<p>圖畫</p>', text: '圖畫' }],
  sentence: null,
  url: 'https://example.com',
  documentTitle: 'Example',
};

describe('AnkiService', () => {
  let settings: Settings;
  let client: FakeClient;
  let service: AnkiService;

  beforeEach(() => {
    settings = defaultSettings();
    settings.anki.enabled = true;
    settings.anki.deck = 'Acetylcholine Test';
    settings.anki.model = 'CN Mining';
    settings.anki.fields = { Word: '{expression}', Reading: '{reading}', Definition: '{glossary}' };
    client = new FakeClient();
    service = new AnkiService(
      () => Promise.resolve(settings),
      () => client,
    );
  });

  it('reports status without touching Anki when disabled', async () => {
    settings.anki.enabled = false;
    expect(await service.status()).toEqual({ enabled: false, configured: true, connected: false });
    expect(client.calls).toEqual([]);
  });

  it('reports the connection, a refusal, and a network failure', async () => {
    expect(await service.status()).toMatchObject({
      connected: true,
      version: 6,
      permission: 'granted',
    });
    client.permission = 'denied';
    expect(await service.status()).toMatchObject({ connected: false, permission: 'denied' });
    client.fail = 'Cannot reach AnkiConnect';
    expect(await service.status()).toMatchObject({
      connected: false,
      error: 'Cannot reach AnkiConnect',
    });
  });

  it('checks duplicates on the first field of the note type', async () => {
    client.notesByQuery.set('"note:CN Mining" "Word:圖片"', [1, 2]);
    const [dup, fresh] = await service.check([note, { ...note, expression: '理髮' }]);
    expect(dup).toEqual({ canAdd: false, noteIds: [1, 2] });
    expect(fresh).toEqual({ canAdd: true, noteIds: [] });
    // The field list is fetched once and duplicate queries are cached.
    await service.check([note]);
    expect(client.calls.filter((c) => c[0] === 'modelFieldNames')).toHaveLength(1);
    expect(client.calls.filter((c) => c[0] === 'findNotes')).toHaveLength(2);
  });

  it('honours allowDuplicates, deck scope and an empty first field', async () => {
    settings.anki.allowDuplicates = true;
    settings.anki.duplicateScope = 'deck';
    client.notesByQuery.set('"note:CN Mining" "Word:圖片" "deck:Acetylcholine Test"', [7]);
    expect(await service.check([note])).toEqual([{ canAdd: true, noteIds: [7] }]);
    settings.anki.fields = { Word: '{reading:kana}' };
    service.invalidate();
    const [r] = await service.check([note]);
    expect(r!.canAdd).toBe(false);
    expect(r!.reason).toContain('Word');
  });

  it('stores media, adds the note with expanded fields, and forgets cached duplicates', async () => {
    await service.check([note]);
    const { noteId } = await service.add(note, [{ filename: 'ace-x.png', data: 'AAAA' }]);
    expect(noteId).toBe(100);
    const added = client.calls.find((c) => c[0] === 'addNote')![1] as AnkiConnectNote;
    expect(client.calls.map((c) => c[0])).toContain('storeMediaFile');
    expect(added).toMatchObject({
      deckName: 'Acetylcholine Test',
      modelName: 'CN Mining',
      tags: ['acetylcholine'],
      options: { allowDuplicate: false, duplicateScope: 'collection' },
    });
    expect(added.fields.Word).toBe('圖片');
    expect(added.fields.Reading).toBe('tú piàn'); // default profile prefers pinyin
    expect(added.fields.Definition).toContain('<p>圖畫</p>');
    await service.check([note]);
    expect(client.calls.filter((c) => c[0] === 'findNotes')).toHaveLength(2);
  });

  it('opens the browser on the given notes', async () => {
    await service.view([1, 2]);
    expect(client.calls).toContainEqual(['guiBrowse', 'nid:1,2']);
  });
});
