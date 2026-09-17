/**
 * Unlisted script built to `import-worker.js`; the options page runs it as a Web Worker.
 */
import { startImportWorker } from '$lib/import/import.worker';

export default defineUnlistedScript(() => {
  startImportWorker();
});
