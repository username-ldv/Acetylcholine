<script lang="ts">
import type { AceReading } from '@acetylcholine/ace';
import { type PopupProfileOptions, selectReadings } from '@acetylcholine/shared';
import type { Snippet } from 'svelte';

interface Props {
  headwords: string[];
  readings: AceReading[];
  options: PopupProfileOptions;
  /** Controls rendered at the right end of the header (Anki buttons). */
  actions?: Snippet;
}

let { headwords, readings, options, actions }: Props = $props();

const selection = $derived(selectReadings(readings, options.readingTags));
const canonical = $derived(headwords[0] ?? '');
const variants = $derived(headwords.slice(1));
/** Secondary systems: hidden, small, or the same size as the primary ones. */
const secondaryClass = $derived(
  options.readingDisplay === 'primary'
    ? null
    : options.readingDisplay === 'all'
      ? 'ace-reading'
      : 'ace-reading-secondary',
);
</script>

<header class="ace-group-header">
  <div class="ace-headwords">
    <span class="ace-headword" lang="zh">{canonical}</span>
    {#each variants as variant (variant)}
      <span class="ace-variant" lang="zh">{variant}</span>
    {/each}
  </div>
  {#if readings.length === 0}
    <span class="ace-reading-none" title="This entry has no reading">no reading</span>
  {:else}
    <div class="ace-readings">
      {#each selection.primary as reading, i (reading.text)}
        {#if i > 0}<span class="ace-reading-sep">/</span>{/if}
        <span class="ace-reading" data-tag={selection.primaryTag}>{reading.text}</span>
      {/each}
      {#if secondaryClass}
        {#each selection.secondary as reading (reading.text)}
          <span class={secondaryClass} data-tag={reading.tags[0]}>{reading.text}</span>
        {/each}
      {/if}
    </div>
  {/if}
  {#if actions}
    {@render actions()}
  {/if}
</header>
