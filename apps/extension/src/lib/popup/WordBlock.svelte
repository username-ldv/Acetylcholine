<script lang="ts">
import type { AceReading } from '@acetylcholine/ace';
import {
  contentReadingTag,
  type DictionaryInfo,
  type PopupProfileOptions,
  selectReadings,
  type WordBlock,
} from '@acetylcholine/shared';
import DictionaryContent from './DictionaryContent.svelte';
import ReadingsHeader from './ReadingsHeader.svelte';

interface Props {
  block: WordBlock;
  dictionaries: Map<string, DictionaryInfo>;
  options: PopupProfileOptions;
  onLookup: (term: string) => void;
}

let { block, dictionaries, options, onLookup }: Props = $props();

/** Reading badge text for one definition: its primary-system readings (all systems when asked). */
function badge(readings: AceReading[]): string | null {
  if (readings.length === 0) return null;
  const sel = selectReadings(readings, options.readingTags);
  const parts = sel.primary.map((r) => r.text);
  if (options.readingDisplay === 'all') parts.push(...sel.secondary.map((r) => r.text));
  return parts.join(' / ');
}
</script>

<section class="ace-word">
  <ReadingsHeader headwords={block.headwords} readings={block.readings} {options} />

  {#each block.dictionaries as bucket (bucket.dictionary)}
    {@const dictionary = dictionaries.get(bucket.dictionary)}
    {#if dictionary}
      <div class="ace-word-dictionary" data-dictionary={dictionary.id}>
        {#each bucket.entries as item, i (item.entry.id)}
          {@const reading = badge(item.entry.readings)}
          <article class="ace-entry">
            {#if i === 0 && options.showDictionaryTitles}
              <span class="ace-dictionary-title">{dictionary.title}</span>
            {/if}
            {#if reading !== null}
              <span class="ace-entry-reading">{reading}</span>
            {:else}
              <span class="ace-entry-reading ace-reading-none" title="This entry has no reading">no reading</span>
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
        {/each}
      </div>
    {/if}
  {/each}
</section>
