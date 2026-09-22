/**
 * Message protocol between extension contexts.
 *
 * - `BackgroundRequest` / `BackgroundResponse`: content script, popup, options → background
 *   (`browser.runtime.sendMessage`). Payloads must be JSON-serialisable (Chrome).
 * - `PopupInbound` / `PopupOutbound`: content script ↔ popup iframe (`window.postMessage`).
 */

import type { AnkiMediaFile, AnkiNoteData, LookupContext } from './anki.ts';
import type { DictionaryInfo, LookupResult } from './lookup/types.ts';
import type {
  Profile,
  ReadingDisplay,
  ResultLayout,
  ScanningOptions,
  Settings,
} from './settings.ts';

export interface LookupRequest {
  type: 'lookup';
  text: string;
  /** Profile to use; the active profile when omitted. */
  profileId?: string;
  /** Skip the cache (used after settings changes). */
  fresh?: boolean;
}

export interface AnkiStatus {
  enabled: boolean;
  /** Deck, note type and at least one field template are set. */
  configured: boolean;
  connected: boolean;
  /** AnkiConnect API version. */
  version?: number;
  /** AnkiConnect's answer to `requestPermission` for this extension's origin. */
  permission?: 'granted' | 'denied';
  error?: string;
}

/** Whether one note can be added, and the existing notes it would duplicate. */
export interface AnkiCheckResult {
  canAdd: boolean;
  noteIds: number[];
  reason?: string;
}

export type BackgroundRequest =
  | { type: 'ping' }
  | LookupRequest
  | { type: 'listDictionaries' }
  /** Sent by the options page after an import/delete so caches are dropped. */
  | { type: 'dictionariesChanged' }
  | { type: 'getSettings' }
  | { type: 'openOptions'; section?: string }
  | { type: 'anki:status' }
  | { type: 'anki:decks' }
  | { type: 'anki:models' }
  | { type: 'anki:modelFields'; model: string }
  | { type: 'anki:check'; notes: AnkiNoteData[] }
  | { type: 'anki:add'; note: AnkiNoteData; media: AnkiMediaFile[] }
  /** Opens the Anki browser on the given notes. */
  | { type: 'anki:view'; noteIds: number[] };

export interface BackgroundResponses {
  ping: { at: number; version: string };
  lookup: LookupResult;
  listDictionaries: DictionaryInfo[];
  dictionariesChanged: { ok: true };
  getSettings: Settings;
  openOptions: { ok: true };
  'anki:status': AnkiStatus;
  'anki:decks': string[];
  'anki:models': string[];
  'anki:modelFields': string[];
  'anki:check': AnkiCheckResult[];
  'anki:add': { noteId: number };
  'anki:view': { ok: true };
}

export type BackgroundResponse<T extends BackgroundRequest['type']> = BackgroundResponses[T];

/** Error envelope returned by the background when a handler throws. */
export interface BackgroundError {
  __error: string;
}

export function isBackgroundError(value: unknown): value is BackgroundError {
  return typeof value === 'object' && value !== null && '__error' in value;
}

// ---------------------------------------------------------------------------
// content script ↔ popup iframe
// ---------------------------------------------------------------------------

export const POPUP_MESSAGE_PREFIX = 'acetylcholine:';

/** What the popup needs from the profile to render. */
export interface PopupProfileOptions {
  readingTags: string[];
  readingDisplay: ReadingDisplay;
  resultLayout: ResultLayout;
  fontScale: number;
  theme: Profile['popup']['theme'];
  customCss: string;
  showDictionaryTitles: boolean;
  dictionaryCss: Record<string, string>;
  /** Dictionary ids in display order. */
  dictionaryOrder: string[];
  /** Scanning options, so the popup can scan its own content for nested lookups. */
  scanning: ScanningOptions;
  /** Show the "add to Anki" controls. */
  ankiEnabled: boolean;
}

export type PopupInbound =
  | {
      type: 'acetylcholine:show';
      result: LookupResult;
      options: PopupProfileOptions;
      context: LookupContext;
    }
  | { type: 'acetylcholine:options'; options: PopupProfileOptions }
  | { type: 'acetylcholine:hidden' };

export type PopupOutbound =
  | { type: 'acetylcholine:ready' }
  | { type: 'acetylcholine:close' }
  /** Content height so the host can shrink the frame below the configured maximum. */
  | { type: 'acetylcholine:size'; height: number }
  /** Forwarded keyboard/mouse activity so the host can keep the popup open. */
  | { type: 'acetylcholine:activity' }
  /**
   * The popup's resolved colour scheme. The host mirrors it as `color-scheme` on the iframe
   * element, so `prefers-color-scheme` inside the frame (used by dictionary CSS) follows the
   * popup theme instead of the OS.
   */
  | { type: 'acetylcholine:scheme'; dark: boolean };

export function isPopupMessage(value: unknown): value is PopupInbound | PopupOutbound {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith(POPUP_MESSAGE_PREFIX)
  );
}
