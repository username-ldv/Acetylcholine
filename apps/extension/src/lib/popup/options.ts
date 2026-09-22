import type { PopupProfileOptions, Profile, Settings } from '@acetylcholine/shared';

/** The subset of the settings the popup needs to render results for `profile`. */
export function popupOptionsFromProfile(profile: Profile, settings: Settings): PopupProfileOptions {
  const dictionaryCss: Record<string, string> = {};
  for (const pref of profile.dictionaries) {
    if (pref.customCss.trim().length > 0) dictionaryCss[pref.id] = pref.customCss;
  }
  return {
    readingTags: profile.readingTags,
    readingDisplay: profile.readingDisplay,
    resultLayout: profile.resultLayout,
    fontScale: profile.popup.fontScale,
    theme: profile.popup.theme,
    customCss: profile.popup.customCss,
    showDictionaryTitles: profile.popup.showDictionaryTitles,
    dictionaryCss,
    dictionaryOrder: profile.dictionaries.filter((d) => d.enabled).map((d) => d.id),
    scanning: profile.scanning,
    ankiEnabled: settings.anki.enabled,
  };
}
