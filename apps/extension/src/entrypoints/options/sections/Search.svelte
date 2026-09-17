<script lang="ts">
import type { LookupResult } from '@acetylcholine/shared';
import { onMount } from 'svelte';
import { Input } from '$lib/components/ui/input';
import { sendBackground } from '$lib/messaging';
import { popupOptionsFromProfile } from '$lib/popup/options';
import Results from '$lib/popup/Results.svelte';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

let query = $state('');
let result = $state<LookupResult | null>(null);
let error = $state<string | null>(null);
let loading = $state(false);
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const options = $derived(popupOptionsFromProfile(settings.profile));

async function search(text: string) {
  const mine = ++seq;
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    result = null;
    return;
  }
  loading = true;
  try {
    const r = await sendBackground({ type: 'lookup', text: trimmed });
    if (mine === seq) {
      result = r;
      error = null;
    }
  } catch (err) {
    if (mine === seq) error = err instanceof Error ? err.message : String(err);
  } finally {
    if (mine === seq) loading = false;
  }
}

function onInput() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void search(query), 150);
}

function lookup(term: string) {
  query = term;
  void search(term);
}

onMount(() => {
  const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const q = params.get('q');
  if (q) lookup(q);
});
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-lg font-semibold">Search</h2>
    <p class="text-sm text-muted-foreground">
      Look up text directly, using the active profile's dictionaries. Results render exactly as in the popup.
    </p>
  </header>

  <div class="flex items-center gap-3">
    <Input
      class="max-w-md text-base"
      placeholder="读书"
      bind:value={query}
      oninput={onInput}
      onkeydown={(e) => {
        if (e.key === 'Enter') void search(query);
      }}
      data-testid="search-input"
      lang="zh"
    />
    {#if loading}<span class="text-sm text-muted-foreground">Searching…</span>{/if}
  </div>

  {#if error}
    <p class="text-sm text-destructive">{error}</p>
  {/if}

  {#if result}
    <div class="rounded-lg border" data-testid="search-results">
      <div class="border-b px-3 py-1.5 text-xs text-muted-foreground">
        {result.groups.length} result{result.groups.length === 1 ? '' : 's'} · {result.elapsed.toFixed(1)} ms
        {result.cached ? '(cached)' : ''}
      </div>
      <Results {result} {options} onLookup={lookup} />
    </div>
  {/if}
</div>
