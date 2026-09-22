<script lang="ts">
import type { LookupVia } from '@acetylcholine/shared';

interface Props {
  via: LookupVia;
}

let { via }: Props = $props();

const title = $derived(
  via.ambiguous
    ? `Found through the variant form ${via.form}, which is also a form of another word: this entry may describe that word instead.`
    : `Found through the variant form ${via.form}, which the other dictionaries list for this word.`,
);
</script>

<span class="ace-entry-via" class:ace-via-ambiguous={via.ambiguous} {title} lang="zh">
  via {via.form}{#if via.ambiguous}<span class="ace-via-mark" lang="en"> · ambiguous</span>{/if}
</span>
