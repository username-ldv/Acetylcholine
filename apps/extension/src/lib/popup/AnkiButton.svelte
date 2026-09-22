<script lang="ts">
import type { AnkiItemState } from '$lib/anki/controller.svelte';

interface Props {
  state: AnkiItemState;
  onAdd: () => void;
  onView: () => void;
}

let { state, onAdd, onView }: Props = $props();
</script>

<span class="ace-anki" data-status={state.status}>
  {#if state.status === 'checking'}
    <span class="ace-anki-status" title="Checking Anki…">Anki …</span>
  {:else if state.status === 'ready'}
    <button type="button" class="ace-anki-button" title="Add a note to Anki" onclick={onAdd}>+ Anki</button>
  {:else if state.status === 'adding'}
    <span class="ace-anki-status">adding…</span>
  {:else if state.status === 'added'}
    <span class="ace-anki-status ace-anki-done" title="Added to Anki">✓ added</span>
  {:else if state.status === 'duplicate'}
    <span class="ace-anki-status ace-anki-done" title="A note with this word already exists">✓ in Anki</span>
  {:else if state.status === 'blocked'}
    <span class="ace-anki-status ace-anki-muted" title={state.message}>Anki –</span>
  {:else if state.status === 'error'}
    <button type="button" class="ace-anki-button ace-anki-error" title={state.message} onclick={onAdd}>Anki: error ↻</button>
  {/if}
  {#if state.noteIds.length > 0}
    <button type="button" class="ace-anki-button" title="Show in the Anki browser" onclick={onView}>view</button>
  {/if}
</span>
