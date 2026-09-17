/**
 * Web Worker body that imports `.ace` files into IndexedDB, one at a time, reporting progress.
 * Built as the unlisted script `import-worker.js` (see `entrypoints/import-worker.ts`).
 */
import type { AceManifest } from '@acetylcholine/ace';
import { ImportAbortedError, type ImportProgress, importAce } from '../db/index.ts';

export type WorkerRequest =
  | { type: 'import'; id: number; file: Blob }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; progress: ImportProgress }
  | { type: 'done'; id: number; manifest: AceManifest; dictionaryId: string }
  | { type: 'error'; id: number; message: string; aborted: boolean };

export function startImportWorker(scope: Worker = self as unknown as Worker): void {
  const controllers = new Map<number, AbortController>();
  let queue: Promise<void> = Promise.resolve();

  const post = (message: WorkerResponse): void => {
    scope.postMessage(message);
  };

  scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
    const msg = event.data;
    if (msg.type === 'cancel') {
      controllers.get(msg.id)?.abort();
      return;
    }
    const controller = new AbortController();
    controllers.set(msg.id, controller);
    queue = queue.then(async () => {
      try {
        if (controller.signal.aborted) throw new ImportAbortedError();
        const record = await importAce(msg.file, {
          signal: controller.signal,
          onProgress: (progress) => post({ type: 'progress', id: msg.id, progress }),
        });
        post({ type: 'done', id: msg.id, manifest: record.manifest, dictionaryId: record.id });
      } catch (err) {
        post({
          type: 'error',
          id: msg.id,
          message: err instanceof Error ? err.message : String(err),
          aborted: err instanceof ImportAbortedError,
        });
      } finally {
        controllers.delete(msg.id);
      }
    });
  });
}
