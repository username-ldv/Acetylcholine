export type ConvertSource = Blob | Uint8Array;

export type ConvertStage =
  | 'index'
  | 'terms'
  | 'meta'
  | 'tags'
  | 'kanji'
  | 'kanjiMeta'
  | 'assets'
  | 'finish';

export interface ConvertProgress {
  stage: ConvertStage;
  /** Term conversion runs in two passes (1 = analyse, 2 = write). */
  pass?: 1 | 2;
  /** Zero-based index of the input source being processed. */
  source?: number;
  file?: string;
  /** Zero-based index of the current unit of work within the stage. */
  current: number;
  total: number;
}
