import type { AceEntry } from '@acetylcholine/ace';
import { describe, expect, it } from 'vitest';
import { groupHits, mergeGroupsByWord } from '../src/lookup/group.ts';
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

  it('attaches entries whose reading systems are disjoint to the first group, never merging senses', () => {
    const du = entry(['读'], [['dú', ['pinyin']]]);
    const dou = entry(['读'], [['dòu', ['pinyin']]]);
    const canto = entry(['读'], [['duk6', ['jyutping']]]);
    const groups = groupHits(
      [hit('a', du, '读'), hit('a', dou, '读'), hit('c', canto, '读')],
      ['a', 'c'],
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.entries.map((e) => e.entry.id)).toEqual([du.id, canto.id]);
    expect(groups[1]!.entries.map((e) => e.entry.id)).toEqual([dou.id]);
    expect(groups[0]!.readings.map((r) => r.text)).toEqual(['dú', 'duk6']);
  });

  it('keeps entries without a reading in their own group, after the pronounced ones', () => {
    const bareA = entry(['的'], []);
    const di = entry(['的'], [['dì', ['pinyin']]]);
    const bareB = entry(['的'], []);
    const groups = groupHits(
      [hit('a', bareA, '的'), hit('a', di, '的'), hit('b', bareB, '的')],
      ['a', 'b'],
    );
    expect(groups.map((g) => g.entries.map((e) => e.entry.id))).toEqual([
      [di.id],
      [bareA.id, bareB.id],
    ]);
    expect(groups[1]!.readings).toEqual([]);
  });

  it('merges groups into one block per word, dictionary by dictionary, reading-less last', () => {
    const aDi = entry(
      ['的'],
      [
        ['dì', ['pinyin']],
        ['ㄉㄧˋ', ['zhuyin']],
      ],
    );
    const aDe = entry(['的'], [['de', ['pinyin']]]);
    const bBare = entry(['的'], []);
    const bDi = entry(['的'], [['dì', ['pinyin']]]);
    const bDe = entry(['的'], [['de', ['pinyin']]]);
    const groups = groupHits(
      [
        hit('b', bBare, '的'),
        hit('b', bDi, '的'),
        hit('b', bDe, '的'),
        hit('a', aDi, '的'),
        hit('a', aDe, '的'),
      ],
      ['a', 'b'],
    );
    expect(groups).toHaveLength(3);
    const blocks = mergeGroupsByWord(groups, ['a', 'b']);
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.headwords).toEqual(['的']);
    expect(block.readings.map((r) => r.text)).toEqual(['dì', 'ㄉㄧˋ', 'de']);
    // dì and de: two pronunciations; the reading-less group does not count.
    expect(block.pronunciations).toBe(2);
    expect(block.dictionaries.map((d) => d.dictionary)).toEqual(['a', 'b']);
    expect(block.dictionaries[0]!.entries.map((e) => e.entry.id)).toEqual([aDi.id, aDe.id]);
    expect(block.dictionaries[1]!.entries.map((e) => e.entry.id)).toEqual([
      bDi.id,
      bDe.id,
      bBare.id,
    ]);
  });

  it('counts one pronunciation per word when dictionaries agree, even with several systems', () => {
    const a = entry(
      ['读'],
      [
        ['dú', ['pinyin']],
        ['ㄉㄨˊ', ['zhuyin']],
      ],
    );
    const b = entry(['读'], [['dú', ['pinyin']]]);
    const bare = entry(['读'], []);
    const groups = groupHits(
      [hit('a', a, '读'), hit('b', b, '读'), hit('c', bare, '读')],
      ['a', 'b', 'c'],
    );
    const [block] = mergeGroupsByWord(groups, ['a', 'b', 'c']);
    expect(block!.pronunciations).toBe(1);
    expect(block!.dictionaries).toHaveLength(3);
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
