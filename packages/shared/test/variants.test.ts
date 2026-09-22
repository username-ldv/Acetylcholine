import { type AceEntry, AceKeyKind } from '@acetylcholine/ace';
import { describe, expect, it } from 'vitest';
import { groupHits } from '../src/lookup/group.ts';
import type { LookupHit } from '../src/lookup/types.ts';
import {
  mergeVariantHits,
  planVariantProbes,
  type VariantProbe,
  type VariantProbeHit,
} from '../src/lookup/variants.ts';

let nextId = 0;
function entry(headwords: string[], reading: string): AceEntry {
  return {
    id: nextId++,
    headwords,
    readings: [{ text: reading, tags: ['pinyin'] }],
    content: [{ type: 'text', text: headwords.join('/') }],
    tags: [],
    termTags: [],
    rules: [],
    score: 0,
    sequence: -1,
  };
}

function hit(dictionary: string, e: AceEntry, matched: string): LookupHit {
  return { dictionary, entry: e, kinds: [0], matched, length: matched.length };
}

/** Simulates the second query: every entry keyed by the probe's form, as the database would return it. */
function probeHits(
  probes: VariantProbe[],
  keyed: Record<string, [string, AceEntry][]>,
): VariantProbeHit[] {
  const out: VariantProbeHit[] = [];
  for (const probe of probes) {
    for (const [dictionary, e] of keyed[probe.form] ?? []) {
      out.push({ probe, hit: hit(dictionary, e, probe.form) });
    }
  }
  return out;
}

describe('planVariantProbes', () => {
  it('lists every other form the direct hits name, once per candidate', () => {
    const moe = entry(['圖片', '图片'], 'tú piàn');
    const moe2 = entry(['圖片', '图片'], 'tú piàn');
    const probes = planVariantProbes([hit('moe', moe, '圖片'), hit('moe2', moe2, '圖片')]);
    expect(probes).toEqual([{ candidate: { text: '圖片', length: 2 }, form: '图片' }]);
  });

  it('returns nothing when the hits list no other form', () => {
    expect(planVariantProbes([hit('h', entry(['图片'], 'túpiàn'), '图片')])).toEqual([]);
  });
});

describe('mergeVariantHits', () => {
  it('reaches a dictionary that keys the simplified form only (圖片 → 图片)', () => {
    const moe = entry(['圖片', '图片'], 'tú piàn');
    const hanyu = entry(['图片'], 'túpiàn');
    const direct = [hit('moe', moe, '圖片')];
    const probes = planVariantProbes(direct);
    const merged = mergeVariantHits(
      direct,
      probeHits(probes, {
        图片: [
          ['moe', moe],
          ['hanyu', hanyu],
        ],
      }),
    );
    expect(merged).toHaveLength(2);
    const added = merged[1]!;
    expect(added.dictionary).toBe('hanyu');
    expect(added.matched).toBe('圖片');
    expect(added.length).toBe(2);
    expect(added.via).toEqual({ form: '图片', ambiguous: false });
    // The direct hit is untouched and not duplicated.
    expect(merged[0]).toBe(direct[0]);
  });

  it('drops entries about another word sharing the form and marks the form ambiguous (髮 → 发)', () => {
    const moeFa = entry(['髮', '发'], 'fǎ');
    const moeFa2 = entry(['發', '发'], 'fā');
    const hanyuHair = entry(['发'], 'fà');
    const hanyuSend = entry(['发', '發'], 'fā');
    const direct = [hit('moe', moeFa, '髮')];
    const merged = mergeVariantHits(
      direct,
      probeHits(planVariantProbes(direct), {
        发: [
          ['moe', moeFa],
          ['moe', moeFa2],
          ['hanyu', hanyuHair],
          ['hanyu', hanyuSend],
        ],
      }),
    );
    expect(merged.map((h) => h.entry.id)).toEqual([moeFa.id, hanyuHair.id]);
    expect(merged[1]!.via).toEqual({ form: '发', ambiguous: true });
  });

  it('keeps an entry that names another form of the scanned word even with extra forms (乾 → 干)', () => {
    const moeGan = entry(['乾', '干'], 'gān');
    const moeGan4 = entry(['幹', '干'], 'gàn');
    const hanyuGan = entry(['干', '乾', '乹', '亁'], 'gān');
    const hanyuGan4 = entry(['干'], 'gàn');
    const direct = [hit('moe', moeGan, '乾')];
    const merged = mergeVariantHits(
      direct,
      probeHits(planVariantProbes(direct), {
        干: [
          ['moe', moeGan],
          ['moe', moeGan4],
          ['hanyu', hanyuGan],
          ['hanyu', hanyuGan4],
        ],
      }),
    );
    expect(merged.map((h) => h.entry.id)).toEqual([moeGan.id, hanyuGan.id, hanyuGan4.id]);
    // 乾 is among its forms: confirmed, so not ambiguous even though 幹 contests 干.
    expect(merged[1]!.via).toEqual({ form: '干', ambiguous: false });
    // Only 干: kept but ambiguous because 幹 [幹, 干] also claims the form.
    expect(merged[2]!.via).toEqual({ form: '干', ambiguous: true });
  });

  it('adds an entry once even when several forms reach it', () => {
    const moe = entry(['臺灣', '台灣', '台湾'], 'tái wān');
    const hanyu = entry(['台湾', '台灣'], 'táiwān');
    const direct = [hit('moe', moe, '臺灣')];
    const probes = planVariantProbes(direct);
    expect(probes.map((p) => p.form)).toEqual(['台灣', '台湾']);
    const merged = mergeVariantHits(
      direct,
      probeHits(probes, { 台灣: [['hanyu', hanyu]], 台湾: [['hanyu', hanyu]] }),
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]!.via).toEqual({ form: '台灣', ambiguous: false });
  });

  it('keeps candidates of different lengths apart', () => {
    const long = entry(['理髮', '理发'], 'lǐ fǎ');
    const short = entry(['理'], 'lǐ');
    const hanyuLong = entry(['理发'], 'lǐ fà');
    const direct = [hit('moe', long, '理髮'), hit('moe', short, '理')];
    const probes = planVariantProbes(direct);
    expect(probes).toEqual([{ candidate: { text: '理髮', length: 2 }, form: '理发' }]);
    const merged = mergeVariantHits(direct, probeHits(probes, { 理发: [['hanyu', hanyuLong]] }));
    expect(merged[2]).toMatchObject({ matched: '理髮', length: 2, via: { form: '理发' } });
  });

  it('ignores the forms of alias-only direct hits (an MDX redirect vouches for nothing)', () => {
    const moeHair = entry(['髮', '发'], 'fǎ');
    const moeSend = entry(['發', '发'], 'fā');
    // 髮 is an @@@LINK alias to every 发 page, the 發 sense included.
    const mdxSend = entry(['发', '發'], 'fā');
    const direct = [
      hit('moe', moeHair, '髮'),
      { ...hit('mdx', mdxSend, '髮'), kinds: [AceKeyKind.Alias] },
    ];
    const probes = planVariantProbes(direct);
    expect(probes.map((p) => p.form)).toEqual(['发']); // not 發
    const merged = mergeVariantHits(
      direct,
      probeHits(probes, {
        发: [
          ['moe', moeHair],
          ['moe', moeSend],
          ['mdx', mdxSend],
        ],
      }),
    );
    // The alias hit stays (it was a direct match) but 發 [發, 发] is not pulled in through it.
    expect(merged.map((h) => h.entry.id)).toEqual([moeHair.id, mdxSend.id]);
  });
});

describe('groupHits with variant hits', () => {
  it('groups a via entry with the direct one and carries the mark', () => {
    const moe = entry(['圖片', '图片'], 'tú piàn');
    const hanyu = entry(['图片'], 'túpiàn');
    const groups = groupHits(
      [
        hit('moe', moe, '圖片'),
        { ...hit('hanyu', hanyu, '圖片'), via: { form: '图片', ambiguous: false } },
      ],
      ['hanyu', 'moe'],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.headwords).toEqual(['圖片', '图片']);
    expect(groups[0]!.entries.map((e) => [e.dictionary, e.via?.form])).toEqual([
      ['hanyu', '图片'],
      ['moe', undefined],
    ]);
  });

  it('orders groups with a direct entry before groups reached only via a variant', () => {
    const moe = entry(['理髮', '理发'], 'lǐ fǎ');
    const hanyu = entry(['理发'], 'lǐ fà');
    const groups = groupHits(
      [
        hit('moe', moe, '理髮'),
        { ...hit('hanyu', hanyu, '理髮'), via: { form: '理发', ambiguous: false } },
      ],
      ['hanyu', 'moe'], // hanyu ranks first, yet its via-only group must come second
    );
    expect(groups.map((g) => g.headwords[0])).toEqual(['理髮', '理发']);
    expect(groups[1]!.entries[0]!.via).toEqual({ form: '理发', ambiguous: false });
  });
});
