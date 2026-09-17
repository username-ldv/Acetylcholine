<script lang="ts">
import type { AceEntry } from '@acetylcholine/ace';
import type { DictionaryInfo } from '@acetylcholine/shared';
import { renderIntoHost } from './content-host.ts';
import { getDictionaryStyles } from './dictionary-styles.ts';

interface Props {
  entry: AceEntry;
  dictionary: DictionaryInfo;
  customCss: string;
  primaryReadingTag: string | null;
  onLookup: (term: string) => void;
}

let { entry, dictionary, customCss, primaryReadingTag, onLookup }: Props = $props();

let host = $state<HTMLDivElement | null>(null);
let styles = $state<string | null>(null);
let stylesFor = $state<string>('');

$effect(() => {
  const id = dictionary.id;
  if (!dictionary.hasStyles) {
    styles = null;
    stylesFor = id;
    return;
  }
  let cancelled = false;
  void getDictionaryStyles(id).then((css) => {
    if (cancelled) return;
    styles = css;
    stylesFor = id;
  });
  return () => {
    cancelled = true;
  };
});

$effect(() => {
  if (!host || stylesFor !== dictionary.id) return;
  renderIntoHost(host, {
    entry,
    dictionaryNumber: dictionary.n,
    styles,
    customCss,
    primaryReadingTag,
    onLookup,
  });
});
</script>

<div bind:this={host} class="ace-dictionary-content" data-dictionary={dictionary.id}></div>
