<script lang="ts">
import { ACETYLCHOLINE_NAME, ACETYLCHOLINE_VERSION } from '@acetylcholine/shared';
import { onMount, untrack } from 'svelte';
import { applyTheme } from '$lib/popup/theme';
import About from './sections/About.svelte';
import Anki from './sections/Anki.svelte';
import Appearance from './sections/Appearance.svelte';
import Dictionaries from './sections/Dictionaries.svelte';
import Scanning from './sections/Scanning.svelte';
import Search from './sections/Search.svelte';
import { SettingsState } from './settings.svelte';

const sections = [
  { id: 'dictionaries', label: 'Dictionaries' },
  { id: 'scanning', label: 'Scanning' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'anki', label: 'Anki' },
  { id: 'search', label: 'Search' },
  { id: 'about', label: 'About' },
] as const;
type SectionId = (typeof sections)[number]['id'];

const settings = new SettingsState();
let section = $state<SectionId>(readHash());
let loadError = $state<string | null>(null);

function readHash(): SectionId {
  const id = location.hash.replace(/^#/, '').split('?')[0];
  return sections.some((s) => s.id === id) ? (id as SectionId) : 'dictionaries';
}

function navigate(id: SectionId) {
  section = id;
  history.replaceState(null, '', `#${id}`);
}

onMount(() => {
  settings.load().catch((err) => {
    loadError = err instanceof Error ? err.message : String(err);
  });
  const onHash = () => {
    section = readHash();
  };
  window.addEventListener('hashchange', onHash);
  return () => {
    window.removeEventListener('hashchange', onHash);
    settings.dispose();
  };
});

// Autosave: reading the snapshot subscribes to every nested field.
$effect(() => {
  if (!settings.current) return;
  const snapshot = $state.snapshot(settings.current);
  untrack(() => settings.scheduleSave(snapshot));
});

$effect(() => {
  const theme = settings.current?.theme ?? 'auto';
  return applyTheme(theme);
});
</script>

<div class="mx-auto flex min-h-screen max-w-6xl gap-8 px-6 py-8">
  <aside class="w-48 shrink-0">
    <div class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">{ACETYLCHOLINE_NAME}</h1>
      <p class="text-xs text-muted-foreground">v{ACETYLCHOLINE_VERSION}</p>
    </div>
    <nav class="flex flex-col gap-1">
      {#each sections as s (s.id)}
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-left text-sm transition-colors {section === s.id
            ? 'bg-primary text-primary-foreground'
            : 'hover:bg-muted'}"
          onclick={() => navigate(s.id)}
        >
          {s.label}
        </button>
      {/each}
    </nav>
    <div class="mt-6 text-xs text-muted-foreground" aria-live="polite">
      {#if settings.saving}
        Saving…
      {:else if settings.error}
        <span class="text-destructive">Save failed: {settings.error}</span>
      {:else if settings.lastSavedAt}
        Saved
      {/if}
    </div>
  </aside>

  <main class="min-w-0 flex-1">
    {#if loadError}
      <p class="text-destructive">Could not load settings: {loadError}</p>
    {:else if !settings.current}
      <p class="text-muted-foreground">Loading…</p>
    {:else if section === 'dictionaries'}
      <Dictionaries {settings} />
    {:else if section === 'scanning'}
      <Scanning {settings} />
    {:else if section === 'appearance'}
      <Appearance {settings} />
    {:else if section === 'anki'}
      <Anki {settings} />
    {:else if section === 'search'}
      <Search {settings} />
    {:else}
      <About {settings} />
    {/if}
  </main>
</div>
