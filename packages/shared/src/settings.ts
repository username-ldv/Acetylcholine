/**
 * Versioned settings schema for the extension. Stored as JSON in `browser.storage.local`.
 * Every load goes through `migrateSettings()`, which upgrades older shapes and fills defaults.
 */
import { z } from 'zod';

export const SETTINGS_VERSION = 1 as const;

export const scanModifierSchema = z.enum(['shift', 'ctrl', 'alt', 'none']);
export type ScanModifier = z.infer<typeof scanModifierSchema>;

export const scanTriggerSchema = z.enum(['hover', 'click']);
export type ScanTrigger = z.infer<typeof scanTriggerSchema>;

export const themeSchema = z.enum(['auto', 'light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;

export const scanningSchema = z.object({
  /** Key that must be held for hover scanning (`none` = plain hover). */
  modifier: scanModifierSchema.default('shift'),
  trigger: scanTriggerSchema.default('hover'),
  /** Maximum number of characters scanned forward from the cursor. */
  scanLength: z.number().int().min(1).max(64).default(16),
  /** Milliseconds the cursor must rest before a scan starts. */
  delay: z.number().int().min(0).max(2000).default(20),
  /** Also scan text inside the popup (nested lookups by hovering). */
  scanInsidePopup: z.boolean().default(true),
  /** Close the popup when the page scrolls. */
  closeOnScroll: z.boolean().default(false),
  /** CSS selectors of elements that must never be scanned. */
  ignoreSelectors: z.array(z.string()).default([]),
  /** Host patterns (e.g. `*.example.com`) where scanning is disabled. */
  excludedSites: z.array(z.string()).default([]),
});
export type ScanningOptions = z.infer<typeof scanningSchema>;

export const lookupSchema = z.object({
  /**
   * Also look up the other written forms that the direct hits list (圖片 → 图片), so dictionaries
   * that key a word in one script only still appear. Entries found this way are marked with the
   * form used.
   */
  variants: z.boolean().default(true),
});
export type LookupOptions = z.infer<typeof lookupSchema>;

export const popupSchema = z.object({
  width: z.number().int().min(200).max(2000).default(480),
  height: z.number().int().min(150).max(2000).default(360),
  /** Gap between the scanned text and the popup, in CSS pixels. */
  offset: z.number().int().min(0).max(100).default(10),
  /** Font scale for dictionary content (1 = 100 %). */
  fontScale: z.number().min(0.5).max(3).default(1),
  theme: themeSchema.default('auto'),
  /** Extra CSS applied to the popup document. */
  customCss: z.string().default(''),
  /** Show dictionary titles above each dictionary's content. */
  showDictionaryTitles: z.boolean().default(true),
});
export type PopupOptions = z.infer<typeof popupSchema>;

export const dictionaryPreferenceSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(true),
  /** Extra CSS applied inside this dictionary's shadow root. */
  customCss: z.string().default(''),
});
export type DictionaryPreference = z.infer<typeof dictionaryPreferenceSchema>;

export const readingDisplaySchema = z.enum(['primary', 'primary-secondary', 'all']);
export type ReadingDisplay = z.infer<typeof readingDisplaySchema>;

export const resultLayoutSchema = z.enum(['reading', 'dictionary']);
export type ResultLayout = z.infer<typeof resultLayoutSchema>;

export const profileSchema = z.object({
  id: z.string(),
  name: z.string().default('Default'),
  /** Language adapter id (ISO 639-1 where possible). */
  language: z.string().default('zh'),
  /**
   * Dictionaries in display order. Installed dictionaries missing from this list are treated as
   * enabled and appended at the end (in installation order).
   */
  dictionaries: z.array(dictionaryPreferenceSchema).default([]),
  /**
   * Reading tags in order of preference: the first tag an entry has becomes its primary reading.
   * Empty = dictionary order, all readings shown.
   */
  readingTags: z.array(z.string()).default(['pinyin', 'zhuyin']),
  /**
   * Which reading systems the popup shows: only the primary one, the primary large with the others
   * small (default), or all of them alike. Reading-tagged content follows the same choice (`all`
   * shows every system inline).
   */
  readingDisplay: readingDisplaySchema.default('primary-secondary'),
  /**
   * How results are arranged: one card per word + pronunciation with every dictionary inside
   * (`reading`), or one block per word listing each dictionary's definitions with their readings
   * (`dictionary`).
   */
  resultLayout: resultLayoutSchema.default('reading'),
  lookup: lookupSchema.default(() => lookupSchema.parse({})),
  scanning: scanningSchema.default(() => scanningSchema.parse({})),
  popup: popupSchema.default(() => popupSchema.parse({})),
});
export type Profile = z.infer<typeof profileSchema>;

export const ankiSchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default('http://127.0.0.1:8765'),
  /** AnkiConnect API key (`apiKey` in its config); empty when none is required. */
  key: z.string().default(''),
  deck: z.string().default(''),
  model: z.string().default(''),
  /** Note-type field → template with `{markers}` (see `ANKI_MARKERS`). */
  fields: z.record(z.string(), z.string()).default({}),
  tags: z.array(z.string()).default(['acetylcholine']),
  /** Look for existing notes with the same first field before offering to add. */
  checkDuplicates: z.boolean().default(true),
  duplicateScope: z.enum(['collection', 'deck']).default('collection'),
  /** Add the note even when a duplicate exists. */
  allowDuplicates: z.boolean().default(false),
  /**
   * Store each dictionary's stylesheet once in Anki's media folder (`_ace-<dictionary>.css`,
   * scoped to the glossary) and link it from `{glossary}`, so definitions look as in the popup.
   */
  glossaryStyles: z.boolean().default(true),
});
export type AnkiOptions = z.infer<typeof ankiSchema>;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  activeProfile: z.string(),
  profiles: z.array(profileSchema).min(1),
  anki: ankiSchema.default(() => ankiSchema.parse({})),
  /** Theme of the settings page itself. */
  theme: themeSchema.default('auto'),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_PROFILE_ID = 'default';

export function defaultProfile(id = DEFAULT_PROFILE_ID, name = 'Default'): Profile {
  return profileSchema.parse({ id, name });
}

export function defaultSettings(): Settings {
  return settingsSchema.parse({
    version: SETTINGS_VERSION,
    activeProfile: DEFAULT_PROFILE_ID,
    profiles: [defaultProfile()],
  });
}

/**
 * Upgrades any stored value to the current settings shape. Unknown or corrupt input yields the
 * defaults; partially valid input keeps whatever validates.
 */
export function migrateSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const obj = { ...(raw as Record<string, unknown>) };
  // Future migrations: `if (obj.version === 1) { … ; obj.version = 2 }`.
  if (obj.version !== SETTINGS_VERSION) obj.version = SETTINGS_VERSION;
  const parsed = settingsSchema.safeParse(obj);
  if (parsed.success) return ensureActiveProfile(parsed.data);
  // Salvage: profiles individually, then the rest.
  const profiles: Profile[] = [];
  if (Array.isArray(obj.profiles)) {
    for (const p of obj.profiles) {
      const r = profileSchema.safeParse(p);
      if (r.success) profiles.push(r.data);
    }
  }
  if (profiles.length === 0) profiles.push(defaultProfile());
  const fallback = settingsSchema.safeParse({
    version: SETTINGS_VERSION,
    activeProfile: typeof obj.activeProfile === 'string' ? obj.activeProfile : profiles[0]!.id,
    profiles,
    anki: obj.anki,
    theme: obj.theme,
  });
  return ensureActiveProfile(fallback.success ? fallback.data : defaultSettings());
}

function ensureActiveProfile(settings: Settings): Settings {
  if (!settings.profiles.some((p) => p.id === settings.activeProfile)) {
    settings.activeProfile = settings.profiles[0]!.id;
  }
  return settings;
}

export function getActiveProfile(settings: Settings): Profile {
  return settings.profiles.find((p) => p.id === settings.activeProfile) ?? settings.profiles[0]!;
}

/**
 * Effective dictionary list for a profile given the installed dictionaries: the profile's
 * ordered preferences first (dropping uninstalled ones), then any installed dictionary the
 * profile has not seen yet, enabled by default.
 */
export function resolveDictionaryPreferences(
  profile: Profile,
  installedIds: readonly string[],
): DictionaryPreference[] {
  const installed = new Set(installedIds);
  const out: DictionaryPreference[] = [];
  const seen = new Set<string>();
  for (const pref of profile.dictionaries) {
    if (!installed.has(pref.id) || seen.has(pref.id)) continue;
    seen.add(pref.id);
    out.push(pref);
  }
  for (const id of installedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, enabled: true, customCss: '' });
  }
  return out;
}
