import type { PopupProfileOptions, Profile } from '@acetylcholine/shared';

/** The subset of a profile the popup needs to render results. */
export function popupOptionsFromProfile(profile: Profile): PopupProfileOptions {
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
  };
}
