<script lang="ts">
import {
  type DictionaryInfo,
  type LookupGroup,
  type PopupProfileOptions,
  primaryReadingTagFor,
  selectReadings,
} from '@acetylcholine/shared';
import DictionaryContent from './DictionaryContent.svelte';

interface Props {
  group: LookupGroup;
  dictionaries: Map<string, DictionaryInfo>;
  options: PopupProfileOptions;
  onLookup: (term: string) => void;
}

let { group, dictionaries, options, onLookup }: Props = $props();

const readings = $derived(selectReadings(group.readings, options.readingTags));
const canonical = $derived(group.headwords[0] ?? group.matched);
const variants = $derived(group.headwords.slice(1));
</script>

<section class="ace-group">
  <header class="ace-group-header">
    <div class="ace-headwords">
      <span class="ace-headword" lang="zh">{canonical}</span>
      {#each variants as variant (variant)}
        <span class="ace-variant" lang="zh">{variant}</span>
      {/each}
    </div>
    {#if readings.primary.length > 0}
      <div class="ace-readings">
        {#each readings.primary as reading, i (reading.text)}
          {#if i > 0}<span class="ace-reading-sep">/</span>{/if}
          <span class="ace-reading" data-tag={readings.primaryTag}>{reading.text}</span>
        {/each}
        {#if options.showSecondaryReadings}
          {#each readings.secondary as reading (reading.text)}
            <span class="ace-reading-secondary" data-tag={reading.tags[0]}>{reading.text}</span>
          {/each}
        {/if}
      </div>
    {/if}
  </header>

  {#each group.entries as item (`${item.dictionary}:${item.entry.id}`)}
    {@const dictionary = dictionaries.get(item.dictionary)}
    {#if dictionary}
      <article class="ace-entry">
        {#if options.showDictionaryTitles}
          <div class="ace-dictionary-title">{dictionary.title}</div>
        {/if}
        <DictionaryContent
          entry={item.entry}
          {dictionary}
          customCss={options.dictionaryCss[dictionary.id] ?? ''}
          primaryReadingTag={primaryReadingTagFor(dictionary.readingTags, options.readingTags)}
          {onLookup}
        />
      </article>
    {/if}
  {/each}
</section>
