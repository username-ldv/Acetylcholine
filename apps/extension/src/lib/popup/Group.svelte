<script lang="ts">
import {
  contentReadingTag,
  type DictionaryInfo,
  type LookupGroup,
  type PopupProfileOptions,
} from '@acetylcholine/shared';
import DictionaryContent from './DictionaryContent.svelte';
import ReadingsHeader from './ReadingsHeader.svelte';
import ViaBadge from './ViaBadge.svelte';

interface Props {
  group: LookupGroup;
  dictionaries: Map<string, DictionaryInfo>;
  options: PopupProfileOptions;
  onLookup: (term: string) => void;
}

let { group, dictionaries, options, onLookup }: Props = $props();
</script>

<section class="ace-group">
  <ReadingsHeader headwords={group.headwords} readings={group.readings} {options} />

  {#each group.entries as item (`${item.dictionary}:${item.entry.id}`)}
    {@const dictionary = dictionaries.get(item.dictionary)}
    {#if dictionary}
      <article class="ace-entry">
        {#if options.showDictionaryTitles}
          <span class="ace-dictionary-title">{dictionary.title}</span>
        {/if}
        {#if item.via}
          <ViaBadge via={item.via} />
        {/if}
        <DictionaryContent
          entry={item.entry}
          {dictionary}
          customCss={options.dictionaryCss[dictionary.id] ?? ''}
          primaryReadingTag={contentReadingTag(
            dictionary.readingTags,
            options.readingTags,
            options.readingDisplay,
          )}
          {onLookup}
        />
      </article>
    {/if}
  {/each}
</section>
