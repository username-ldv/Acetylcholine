<script lang="ts">
import {
  type DictionaryInfo,
  type LookupResult,
  mergeGroupsByWord,
  type PopupProfileOptions,
} from '@acetylcholine/shared';
import Group from './Group.svelte';
import WordBlock from './WordBlock.svelte';

interface Props {
  result: LookupResult;
  options: PopupProfileOptions;
  onLookup: (term: string) => void;
}

let { result, options, onLookup }: Props = $props();

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
</script>

<div class="ace-results" data-layout={options.resultLayout} style:font-size="{options.fontScale * 100}%">
  {#if result.groups.length === 0}
    <p class="ace-empty">No results for “{result.text}”.</p>
  {:else if blocks}
    {#each blocks as block, i (`${block.matched}:${i}`)}
      <WordBlock {block} {dictionaries} {options} {onLookup} />
    {/each}
  {:else}
    {#each result.groups as group, i (`${group.matched}:${i}`)}
      <Group {group} {dictionaries} {options} {onLookup} />
    {/each}
  {/if}
</div>
