/**
 * Options-page side of the import worker: a reactive queue of jobs with progress.
 */
import type { ImportProgress } from '../db/index.ts';
import type { WorkerRequest, WorkerResponse } from './import.worker.ts';

export type ImportJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface ImportJob {
  id: number;
  fileName: string;
  fileSize: number;
  status: ImportJobStatus;
  progress: ImportProgress | null;
  title: string;
  dictionaryId: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export class ImportQueue {
  jobs = $state<ImportJob[]>([]);
  private worker: Worker | null = null;
  private nextId = 1;

  constructor(private readonly onFinished?: (job: ImportJob) => void) {}

  get active(): ImportJob[] {
    return this.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  }

  get busy(): boolean {
    return this.active.length > 0;
  }

  add(files: Iterable<File>): void {
    for (const file of files) {
      const job: ImportJob = {
        id: this.nextId++,
        fileName: file.name,
        fileSize: file.size,
        status: 'queued',
        progress: null,
        title: '',
        dictionaryId: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      };
      this.jobs.push(job);
      this.send({ type: 'import', id: job.id, file });
    }
  }

  cancel(id: number): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    this.send({ type: 'cancel', id });
  }

  /** Removes finished jobs from the list. */
  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private send(message: WorkerRequest): void {
    this.ensureWorker().postMessage(message);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Built by WXT from `entrypoints/import-worker.ts` (unlisted script, self-contained bundle).
    const worker = new Worker(browser.runtime.getURL('/import-worker.js'));
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const job = this.jobs.find((j) => j.id === msg.id);
      if (!job) return;
      switch (msg.type) {
        case 'progress':
          job.status = 'running';
          job.progress = msg.progress;
          if (msg.progress.title) job.title = msg.progress.title;
          break;
        case 'done':
          job.status = 'done';
          job.title = msg.manifest.title;
          job.dictionaryId = msg.dictionaryId;
          job.finishedAt = Date.now();
          this.onFinished?.(job);
          break;
        case 'error':
          job.status = msg.aborted ? 'cancelled' : 'error';
          job.error = msg.aborted ? null : msg.message;
          job.finishedAt = Date.now();
          this.onFinished?.(job);
          break;
      }
    });
    worker.addEventListener('error', (event) => {
      for (const job of this.active) {
        job.status = 'error';
        job.error = event.message || 'Import worker crashed';
        job.finishedAt = Date.now();
        this.onFinished?.(job);
      }
      worker.terminate();
      this.worker = null;
    });
    this.worker = worker;
    return worker;
  }
}
