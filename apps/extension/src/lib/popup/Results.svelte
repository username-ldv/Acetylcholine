<script lang="ts">
import type { DictionaryInfo, LookupResult, PopupProfileOptions } from '@acetylcholine/shared';
import Group from './Group.svelte';

interface Props {
  result: LookupResult;
  options: PopupProfileOptions;
  onLookup: (term: string) => void;
}

let { result, options, onLookup }: Props = $props();

const dictionaries = $derived(
  new Map<string, DictionaryInfo>(result.dictionaries.map((d) => [d.id, d])),
);
</script>

<div class="ace-results" style:font-size="{options.fontScale * 100}%">
  {#if result.groups.length === 0}
    <p class="ace-empty">No results for “{result.text}”.</p>
  {:else}
    {#each result.groups as group, i (`${group.matched}:${i}`)}
      <Group {group} {dictionaries} {options} {onLookup} />
    {/each}
  {/if}
</div>
