import {
  ACETYLCHOLINE_NAME,
  ACETYLCHOLINE_VERSION,
  type BackgroundRequest,
  type Settings,
} from '@acetylcholine/shared';
import { AnkiService } from '$lib/anki/service';
import { LookupService } from '$lib/lookup-service';
import { loadSettings, watchSettings } from '$lib/settings-store';

export default defineBackground(() => {
  console.log(`[${ACETYLCHOLINE_NAME}] background started`, { id: browser.runtime.id });

  let settings: Promise<Settings> | null = null;
  const getSettings = (): Promise<Settings> => {
    if (!settings) {
      settings = loadSettings();
      settings.catch(() => {
        settings = null;
      });
    }
    return settings;
  };
  watchSettings((next) => {
    settings = Promise.resolve(next);
    service.invalidateResults();
    anki.invalidate();
  });

  const service = new LookupService(getSettings);
  const anki = new AnkiService(getSettings);

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  async function handle(message: BackgroundRequest): Promise<unknown> {
    switch (message.type) {
      case 'ping':
        return { at: Date.now(), version: ACETYLCHOLINE_VERSION };
      case 'lookup':
        return service.lookup(message.text, message.profileId, message.fresh);
      case 'listDictionaries':
        return service.listDictionaryInfo();
      case 'dictionariesChanged':
        service.invalidateDictionaries();
        return { ok: true };
      case 'getSettings':
        return getSettings();
      case 'openOptions': {
        const url = browser.runtime.getURL('/options.html');
        const target = message.section ? `${url}#${message.section}` : url;
        await browser.tabs.create({ url: target });
        return { ok: true };
      }
      case 'anki:status':
        return anki.status();
      case 'anki:decks':
        return anki.decks();
      case 'anki:models':
        return anki.models();
      case 'anki:modelFields':
        return anki.modelFields(message.model);
      case 'anki:check':
        return anki.check(message.notes);
      case 'anki:add':
        return anki.add(message.note, message.media);
      case 'anki:view':
        await anki.view(message.noteIds);
        return { ok: true };
      default:
        throw new Error(`Unknown message type ${(message as { type: string }).type}`);
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as BackgroundRequest | null;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
    handle(msg).then(
      (result) => sendResponse(result ?? null),
      (err: unknown) => {
        console.error(`[${ACETYLCHOLINE_NAME}] ${msg.type} failed`, err);
        sendResponse({ __error: err instanceof Error ? err.message : String(err) });
      },
    );
    return true;
  });
});
