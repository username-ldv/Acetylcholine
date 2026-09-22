/**
 * Variant-form expansion: dictionaries that key a word in one script only (现代汉语词典 has 图片
 * but not 圖片) are reached through the other forms that the direct hits list (the MOE
 * dictionaries key 圖片 *and* say its other form is 图片). No script conversion is involved; only
 * forms the dictionaries themselves associate with the scanned word are looked up.
 */
import { AceKeyKind } from '@acetylcholine/ace';
import type { ScanCandidate } from '../language/types.ts';
import type { LookupHit } from './types.ts';

/**
 * Whether a direct hit vouches for its entry's forms. An alias key (MDX `@@@LINK`) only
 * redirects to an entry (髮 → every 发 entry, 發 included), so alias-only hits contribute neither
 * forms nor probes; headword and variant keys do.
 */
function vouches(hit: LookupHit): boolean {
  return hit.kinds.some((k) => k !== AceKeyKind.Alias);
}

/** One extra key to look up: a variant form of a candidate that had direct hits. */
export interface VariantProbe {
  candidate: ScanCandidate;
  form: string;
}

/** A hit produced by looking up a probe's form. */
export interface VariantProbeHit {
  probe: VariantProbe;
  hit: LookupHit;
}

function candidateKey(c: ScanCandidate): string {
  return `${c.length}|${c.text}`;
}

/** The candidate a hit answered, keyed like `candidateKey`. */
function hitCandidateKey(hit: LookupHit): string {
  return `${hit.length}|${hit.matched}`;
}

function entryKey(hit: LookupHit): string {
  return `${hit.dictionary}:${hit.entry.id}`;
}

/**
 * Forms to look up in addition to the scanned text: for every candidate with direct hits, the
 * union of its hits' headwords minus the candidate text itself. Each (candidate, form) pair is
 * returned once.
 */
export function planVariantProbes(direct: readonly LookupHit[]): VariantProbe[] {
  const probes: VariantProbe[] = [];
  const seen = new Set<string>();
  for (const hit of direct) {
    if (!vouches(hit)) continue;
    for (const form of hit.entry.headwords) {
      if (form === hit.matched) continue;
      const key = `${hitCandidateKey(hit)}|${form}`;
      if (seen.has(key)) continue;
      seen.add(key);
      probes.push({ candidate: { text: hit.matched, length: hit.length }, form });
    }
  }
  return probes;
}

/**
 * Adds the entries reached through variant forms to the direct hits.
 *
 * For a candidate, `A` is the set of every form its direct hits list (the scanned text and its
 * variants). An entry `E` found through form `v` is kept when it names the scanned word: either
 * it shares with `A` a form other than `v` (现汉's 干 entry listing 乾 among its forms), or all of
 * its forms are in `A` (a simplified-only 图片). An entry whose only link to `A` is `v` while it
 * also names forms outside `A` (發 [發, 发] when 髮 was scanned) is about a different word that
 * happens to share the form: it is dropped, and `v` is marked ambiguous on the entries kept
 * through it. Entries already among the direct hits are never duplicated. Kept hits carry the
 * candidate as `matched` so they group with the direct hits.
 */
export function mergeVariantHits(
  direct: readonly LookupHit[],
  probeHits: readonly VariantProbeHit[],
): LookupHit[] {
  if (probeHits.length === 0) return [...direct];

  const formsByCandidate = new Map<string, Set<string>>();
  const directByCandidate = new Map<string, Set<string>>();
  for (const hit of direct) {
    const key = hitCandidateKey(hit);
    let forms = formsByCandidate.get(key);
    if (!forms) {
      forms = new Set([hit.matched]);
      formsByCandidate.set(key, forms);
    }
    if (vouches(hit)) for (const h of hit.entry.headwords) forms.add(h);
    let ids = directByCandidate.get(key);
    if (!ids) {
      ids = new Set();
      directByCandidate.set(key, ids);
    }
    ids.add(entryKey(hit));
  }

  interface Kept {
    probe: VariantProbe;
    hit: LookupHit;
    confirmed: boolean;
  }
  const kept: Kept[] = [];
  const contested = new Set<string>(); // `${candidateKey}|${form}`
  const seen = new Set<string>(); // `${candidateKey}|${entryKey}`
  for (const { probe, hit } of probeHits) {
    const cKey = candidateKey(probe.candidate);
    const forms = formsByCandidate.get(cKey);
    if (!forms) continue;
    const eKey = entryKey(hit);
    if (directByCandidate.get(cKey)?.has(eKey)) continue;
    const shared = hit.entry.headwords.filter((h) => forms.has(h));
    const extra = hit.entry.headwords.some((h) => !forms.has(h));
    const confirmed = shared.some((h) => h !== probe.form);
    if (!confirmed && extra) {
      contested.add(`${cKey}|${probe.form}`);
      continue;
    }
    const dedupe = `${cKey}|${eKey}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    kept.push({ probe, hit, confirmed });
  }

  const out = [...direct];
  for (const { probe, hit, confirmed } of kept) {
    const cKey = candidateKey(probe.candidate);
    out.push({
      ...hit,
      matched: probe.candidate.text,
      length: probe.candidate.length,
      via: {
        form: probe.form,
        ambiguous: !confirmed && contested.has(`${cKey}|${probe.form}`),
      },
    });
  }
  return out;
}
