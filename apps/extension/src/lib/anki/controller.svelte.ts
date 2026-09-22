/**
 * Anki state for the results on screen: one item per result group (or word block), checked
 * against Anki for duplicates when the results appear, added on request.
 */
import { sendBackground } from '../messaging.ts';
import { buildNoteData, collectMedia, type NoteBuild, type NoteSource } from './glossary.ts';

export type AnkiItemStatus =
  | 'checking'
  | 'ready'
  | 'duplicate'
  | 'blocked'
  | 'adding'
  | 'added'
  | 'error';

export interface AnkiItemState {
  status: AnkiItemStatus;
  /** Existing notes for this word (duplicates), or the note just added. */
  noteIds: number[];
  message?: string;
}

/** What one result card gets: its state and the two actions. */
export interface AnkiControls {
  state: AnkiItemState;
  add: () => void;
  view: () => void;
}

export class AnkiController {
  items = $state<AnkiItemState[]>([]);
  private builds: Promise<NoteBuild>[] = [];
  private seq = 0;

  /** Starts over with one item per source; the duplicate check runs in the background. */
  prepare(sources: readonly NoteSource[]): void {
    const mine = ++this.seq;
    this.items = sources.map(() => ({ status: 'checking', noteIds: [] }));
    this.builds = sources.map((s) => buildNoteData(s));
    void this.check(mine);
  }

  clear(): void {
    this.seq++;
    this.items = [];
    this.builds = [];
  }

  private async check(mine: number): Promise<void> {
    try {
      const builds = await Promise.all(this.builds);
      if (mine !== this.seq) return;
      const results = await sendBackground({
        type: 'anki:check',
        notes: builds.map((b) => b.note),
      });
      if (mine !== this.seq) return;
      this.items = results.map((r) => {
        if (r.canAdd) return { status: 'ready', noteIds: r.noteIds };
        if (r.noteIds.length > 0) return { status: 'duplicate', noteIds: r.noteIds };
        return { status: 'blocked', noteIds: [], message: r.reason };
      });
    } catch (err) {
      if (mine !== this.seq) return;
      const message = err instanceof Error ? err.message : String(err);
      this.items = this.items.map(() => ({ status: 'error', noteIds: [], message }));
    }
  }

  async add(index: number): Promise<void> {
    const build = this.builds[index];
    const item = this.items[index];
    if (!build || !item || item.status === 'adding') return;
    const mine = this.seq;
    this.items[index] = { ...item, status: 'adding' };
    try {
      const { note, media } = await build;
      const files = await collectMedia(media);
      const { noteId } = await sendBackground({ type: 'anki:add', note, media: files });
      if (mine !== this.seq) return;
      this.items[index] = { status: 'added', noteIds: [noteId] };
    } catch (err) {
      if (mine !== this.seq) return;
      this.items[index] = {
        status: 'error',
        noteIds: item.noteIds,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async view(index: number): Promise<void> {
    const ids = this.items[index]?.noteIds ?? [];
    if (ids.length === 0) return;
    try {
      await sendBackground({ type: 'anki:view', noteIds: ids });
    } catch (err) {
      console.warn('[Acetylcholine] could not open the Anki browser', err);
    }
  }
}
