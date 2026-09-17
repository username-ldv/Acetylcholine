/**
 * Reactive settings for the options page with debounced autosave and cross-context sync.
 */
import { getActiveProfile, type Profile, type Settings } from '@acetylcholine/shared';
import { loadSettings, saveSettings, watchSettings } from '$lib/settings-store';

export class SettingsState {
  current = $state<Settings | null>(null);
  saving = $state(false);
  error = $state<string | null>(null);
  lastSavedAt = $state<number | null>(null);

  private lastSerialized = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unwatch: (() => void) | null = null;

  get profile(): Profile {
    if (!this.current) throw new Error('Settings not loaded');
    return getActiveProfile(this.current);
  }

  async load(): Promise<void> {
    const loaded = await loadSettings();
    this.lastSerialized = JSON.stringify(loaded);
    this.current = loaded;
    this.unwatch?.();
    this.unwatch = watchSettings((next) => {
      const serialized = JSON.stringify(next);
      if (serialized === this.lastSerialized) return;
      this.lastSerialized = serialized;
      this.current = next;
    });
  }

  /** Schedules a save if the snapshot differs from what is stored. */
  scheduleSave(snapshot: Settings): void {
    const serialized = JSON.stringify(snapshot);
    if (serialized === this.lastSerialized) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save(snapshot, serialized);
    }, 250);
  }

  async save(snapshot: Settings, serialized = JSON.stringify(snapshot)): Promise<void> {
    this.saving = true;
    try {
      this.lastSerialized = serialized;
      await saveSettings(snapshot);
      this.lastSavedAt = Date.now();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    this.unwatch?.();
    this.unwatch = null;
    if (this.timer !== null) clearTimeout(this.timer);
  }
}
