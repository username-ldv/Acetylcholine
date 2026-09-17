import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  getActiveProfile,
  migrateSettings,
  resolveDictionaryPreferences,
  SETTINGS_VERSION,
} from '../src/settings.ts';

describe('settings', () => {
  it('produces complete defaults', () => {
    const s = defaultSettings();
    expect(s.version).toBe(SETTINGS_VERSION);
    expect(s.profiles).toHaveLength(1);
    const p = getActiveProfile(s);
    expect(p.scanning.modifier).toBe('shift');
    expect(p.scanning.scanLength).toBe(16);
    expect(p.popup.width).toBe(480);
    expect(p.readingTags).toEqual(['pinyin', 'zhuyin']);
  });

  it('fills missing fields on migrate and keeps valid values', () => {
    const s = migrateSettings({
      version: 1,
      activeProfile: 'p1',
      profiles: [{ id: 'p1', name: 'Mine', scanning: { modifier: 'ctrl' } }],
    });
    const p = getActiveProfile(s);
    expect(p.name).toBe('Mine');
    expect(p.scanning.modifier).toBe('ctrl');
    expect(p.scanning.scanLength).toBe(16);
    expect(p.popup.theme).toBe('auto');
  });

  it('falls back to defaults for garbage and repairs the active profile', () => {
    expect(migrateSettings(null).profiles).toHaveLength(1);
    expect(migrateSettings('x').profiles).toHaveLength(1);
    const s = migrateSettings({
      version: 1,
      activeProfile: 'missing',
      profiles: [{ id: 'a' }, { id: 7 }],
    });
    expect(s.profiles.map((p) => p.id)).toEqual(['a']);
    expect(s.activeProfile).toBe('a');
  });

  it('resolves dictionary preferences against installed dictionaries', () => {
    const profile = getActiveProfile(defaultSettings());
    profile.dictionaries = [
      { id: 'b', enabled: false, customCss: '' },
      { id: 'gone', enabled: true, customCss: '' },
      { id: 'a', enabled: true, customCss: '' },
    ];
    const prefs = resolveDictionaryPreferences(profile, ['a', 'b', 'c']);
    expect(prefs.map((p) => [p.id, p.enabled])).toEqual([
      ['b', false],
      ['a', true],
      ['c', true],
    ]);
  });
});
