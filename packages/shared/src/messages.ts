/**
 * Message protocol between extension contexts.
 *
 * - `BackgroundRequest` / `BackgroundResponse`: content script, popup, options → background
 *   (`browser.runtime.sendMessage`). Payloads must be JSON-serialisable (Chrome).
 * - `PopupInbound` / `PopupOutbound`: content script ↔ popup iframe (`window.postMessage`).
 */

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

export type BackgroundRequest =
  | { type: 'ping' }
  | LookupRequest
  | { type: 'listDictionaries' }
  /** Sent by the options page after an import/delete so caches are dropped. */
  | { type: 'dictionariesChanged' }
  | { type: 'getSettings' }
  | { type: 'openOptions'; section?: string };

export interface BackgroundResponses {
  ping: { at: number; version: string };
  lookup: LookupResult;
  listDictionaries: DictionaryInfo[];
  dictionariesChanged: { ok: true };
  getSettings: Settings;
  openOptions: { ok: true };
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
}

export type PopupInbound =
  | { type: 'acetylcholine:show'; result: LookupResult; options: PopupProfileOptions }
  | { type: 'acetylcholine:options'; options: PopupProfileOptions }
  | { type: 'acetylcholine:hidden' };

export type PopupOutbound =
  | { type: 'acetylcholine:ready' }
  | { type: 'acetylcholine:close' }
  /** Content height so the host can shrink the frame below the configured maximum. */
  | { type: 'acetylcholine:size'; height: number }
  /** Forwarded keyboard/mouse activity so the host can keep the popup open. */
  | { type: 'acetylcholine:activity' };

export function isPopupMessage(value: unknown): value is PopupInbound | PopupOutbound {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith(POPUP_MESSAGE_PREFIX)
  );
}
