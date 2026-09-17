import type { AceReading } from '@acetylcholine/ace';

export interface ReadingSelection {
  /** Reading system chosen for display, or null when the readings carry no tags. */
  primaryTag: string | null;
  /** Readings in the primary system (several when pronunciations are equivalent: shéi / shuí). */
  primary: AceReading[];
  /** Readings in other systems. */
  secondary: AceReading[];
}

/**
 * Picks the reading system to show from the user's preference order. The first preferred tag any
 * reading carries wins; without a preference match the first reading's first tag is used.
 */
export function selectReadings(
  readings: readonly AceReading[],
  preferredTags: readonly string[],
): ReadingSelection {
  if (readings.length === 0) return { primaryTag: null, primary: [], secondary: [] };
  let primaryTag: string | null = null;
  for (const tag of preferredTags) {
    if (readings.some((r) => r.tags.includes(tag))) {
      primaryTag = tag;
      break;
    }
  }
  if (primaryTag === null) primaryTag = readings[0]!.tags[0] ?? null;
  if (primaryTag === null) return { primaryTag: null, primary: [...readings], secondary: [] };
  const primary: AceReading[] = [];
  const secondary: AceReading[] = [];
  for (const r of readings) (r.tags.includes(primaryTag) ? primary : secondary).push(r);
  return { primaryTag, primary, secondary };
}

/**
 * Resolves the reading system used for content nodes tagged `data-sc-reading-tag`: the first
 * preferred tag the dictionary offers, else the dictionary's first tag, else null (show all).
 */
export function primaryReadingTagFor(
  availableTags: readonly string[],
  preferredTags: readonly string[],
): string | null {
  for (const tag of preferredTags) if (availableTags.includes(tag)) return tag;
  return availableTags[0] ?? null;
}

/**
 * CSS that hides content nodes tagged with a reading system other than `primaryTag`. Returns an
 * empty string when every system should stay visible.
 */
export function readingTagVisibilityCss(primaryTag: string | null): string {
  if (primaryTag === null) return '';
  const escaped = primaryTag.replace(/["\\]/g, '\\$&');
  return `[data-sc-reading-tag]:not([data-sc-reading-tag="${escaped}"]){display:none !important;}`;
}
