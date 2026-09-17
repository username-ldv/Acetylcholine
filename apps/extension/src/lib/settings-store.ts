import { migrateSettings, type Settings } from '@acetylcholine/shared';

export const SETTINGS_KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return migrateSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/** Calls `listener` with the migrated settings whenever they change in any context. */
export function watchSettings(listener: (settings: Settings) => void): () => void {
  const onChanged = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string,
  ) => {
    if (area !== 'local') return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    listener(migrateSettings(change.newValue));
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
