import type { AceEntry } from '@acetylcholine/ace';
import { describe, expect, it } from 'vitest';
import { groupHits } from '../src/lookup/group.ts';
import type { LookupHit } from '../src/lookup/types.ts';

let nextId = 0;
function entry(
  headwords: string[],
  readings: [string, string[]][],
  extra: Partial<AceEntry> = {},
): AceEntry {
  return {
    id: nextId++,
    headwords,
    readings: readings.map(([text, tags]) => ({ text, tags })),
    content: [{ type: 'text', text: headwords.join('/') }],
    tags: [],
    termTags: [],
    rules: [],
    score: 0,
    sequence: -1,
    ...extra,
  };
}

function hit(dictionary: string, e: AceEntry, matched: string, length = matched.length): LookupHit {
  return { dictionary, entry: e, kinds: [0], matched, length };
}

describe('groupHits', () => {
  it('merges the same pronunciation across dictionaries and keeps senses apart', () => {
    const guifanDu = entry(
      ['读', '讀'],
      [
        ['dú', ['pinyin']],
        ['ㄉㄨˊ', ['zhuyin']],
      ],
    );
    const guifanDou = entry(
      ['读', '讀'],
      [
        ['dòu', ['pinyin']],
        ['ㄉㄡˋ', ['zhuyin']],
      ],
    );
    const moeDu = entry(
      ['讀', '读'],
      [
        ['ㄉㄨˊ', ['zhuyin']],
        ['dú', ['pinyin']],
      ],
    );
    const moeDou = entry(['讀'], [['ㄉㄡˋ', ['zhuyin']]]);
    const groups = groupHits(
      [
        hit('moe', moeDou, '读'),
        hit('moe', moeDu, '读'),
        hit('guifan', guifanDou, '读'),
        hit('guifan', guifanDu, '读'),
      ],
      ['guifan', 'moe'],
    );
    expect(groups).toHaveLength(2);
    // Same dictionary rank and score: the earlier entry id (dú) leads.
    expect(groups[0]!.entries.map((e) => e.entry.id)).toEqual([guifanDu.id, moeDu.id]);
    expect(groups[1]!.entries.map((e) => e.entry.id)).toEqual([guifanDou.id, moeDou.id]);
    expect(groups[0]!.headwords).toEqual(['读', '讀']);
    expect(groups[0]!.readings).toEqual([
      { text: 'dú', tags: ['pinyin'] },
      { text: 'ㄉㄨˊ', tags: ['zhuyin'] },
    ]);
  });

  it('orders by match length first, then dictionary order, then score', () => {
    const long = entry(['读书'], [['dú shū', ['pinyin']]]);
    const shortA = entry(['读'], [['dú', ['pinyin']]], { score: 1 });
    const shortB = entry(['读'], [['dòu', ['pinyin']]], { score: 5 });
    const groups = groupHits(
      [hit('b', shortA, '读'), hit('a', shortB, '读'), hit('b', long, '读书')],
      ['a', 'b'],
    );
    expect(groups.map((g) => g.matched)).toEqual(['读书', '读', '读']);
    expect(groups[1]!.entries[0]!.entry.id).toBe(shortB.id);
    expect(groups[2]!.entries[0]!.entry.id).toBe(shortA.id);
  });

  it('attaches entries without comparable readings to the first group, never merging senses', () => {
    const du = entry(['读'], [['dú', ['pinyin']]]);
    const dou = entry(['读'], [['dòu', ['pinyin']]]);
    const canto = entry(['读'], [['duk6', ['jyutping']]]);
    const bare = entry(['读'], []);
    const groups = groupHits(
      [hit('a', du, '读'), hit('a', dou, '读'), hit('c', canto, '读'), hit('d', bare, '读')],
      ['a', 'c', 'd'],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.entries.map((e) => e.entry.id)).toEqual([du.id, canto.id, bare.id]);
    expect(groups[1]!.entries.map((e) => e.entry.id)).toEqual([dou.id]);
    expect(groups[0]!.readings.map((r) => r.text)).toEqual(['dú', 'duk6']);
  });

  it('puts the scanned form first among the headwords', () => {
    const e = entry(['读', '讀'], [['dú', ['pinyin']]]);
    expect(groupHits([hit('x', e, '讀')], ['x'])[0]!.headwords).toEqual(['讀', '读']);
    expect(groupHits([hit('x', e, '读')], ['x'])[0]!.headwords).toEqual(['读', '讀']);
    expect(e.headwords).toEqual(['读', '讀']);
  });

  it('does not merge entries with different headwords even with equal readings', () => {
    const a = entry(['是'], [['shì', ['pinyin']]]);
    const b = entry(['事'], [['shì', ['pinyin']]]);
    expect(groupHits([hit('x', a, '是'), hit('x', b, '事')], ['x'])).toHaveLength(2);
  });
});
