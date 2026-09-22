<script lang="ts">
import {
  type DictionaryInfo,
  type LookupContext,
  type LookupResult,
  mergeGroupsByWord,
  type PopupProfileOptions,
} from '@acetylcholine/shared';
import { AnkiController, type AnkiControls } from '$lib/anki/controller.svelte';
import type { NoteSource } from '$lib/anki/glossary';
import Group from './Group.svelte';
import WordBlock from './WordBlock.svelte';

interface Props {
  result: LookupResult;
  options: PopupProfileOptions;
  /** Where the lookup happened (sentence, page); feeds the Anki note. */
  context: LookupContext;
  onLookup: (term: string) => void;
}

let { result, options, context, onLookup }: Props = $props();

const dictionaries = $derived(
  new Map<string, DictionaryInfo>(result.dictionaries.map((d) => [d.id, d])),
);
/** "By dictionary" layout: one block per matched word. */
const blocks = $derived(
  options.resultLayout === 'dictionary'
    ? mergeGroupsByWord(
        result.groups,
        result.dictionaries.map((d) => d.id),
      )
    : null,
);

const anki = new AnkiController();

// One Anki item per card on screen, checked against Anki whenever the results change.
$effect(() => {
  if (!options.ankiEnabled || result.groups.length === 0) {
    anki.clear();
    return;
  }
  const sources: NoteSource[] = blocks
    ? blocks.map((b) => ({
        headwords: b.headwords,
        readings: b.readings,
        entries: b.dictionaries.flatMap((d) => d.entries),
        dictionaries,
        options,
        context,
        readingBadges: b.pronunciations >= 2,
      }))
    : result.groups.map((g) => ({
        headwords: g.headwords,
        readings: g.readings,
        entries: g.entries,
        dictionaries,
        options,
        context,
      }));
  anki.prepare(sources);
});

function ankiFor(index: number): AnkiControls | undefined {
  const state = anki.items[index];
  if (!state) return undefined;
  return { state, add: () => void anki.add(index), view: () => void anki.view(index) };
}
</script>

<div class="ace-results" data-layout={options.resultLayout} style:font-size="{options.fontScale * 100}%">
  {#if result.groups.length === 0}
    <p class="ace-empty">No results for “{result.text}”.</p>
  {:else if blocks}
    {#each blocks as block, i (`${block.matched}:${i}`)}
      <WordBlock {block} {dictionaries} {options} {onLookup} anki={ankiFor(i)} />
    {/each}
  {:else}
    {#each result.groups as group, i (`${group.matched}:${i}`)}
      <Group {group} {dictionaries} {options} {onLookup} anki={ankiFor(i)} />
    {/each}
  {/if}
</div>
