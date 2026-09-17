<script lang="ts">
import { type DictionaryInfo, getActiveProfile, type Settings } from '@acetylcholine/shared';
import { onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import { sendBackground } from '$lib/messaging';

let settings = $state<Settings | null>(null);
let dictionaries = $state<DictionaryInfo[]>([]);

const profile = $derived(settings ? getActiveProfile(settings) : null);
const modifierLabel = $derived.by(() => {
  switch (profile?.scanning.modifier) {
    case 'shift':
      return 'Shift';
    case 'ctrl':
      return 'Ctrl';
    case 'alt':
      return 'Alt';
    default:
      return null;
  }
});

onMount(async () => {
  [settings, dictionaries] = await Promise.all([
    sendBackground({ type: 'getSettings' }),
    sendBackground({ type: 'listDictionaries' }),
  ]);
});

function openSettings(section?: string) {
  void sendBackground({ type: 'openOptions', section });
  window.close();
}
</script>

<div class="w-72 p-4 space-y-3">
  <h1 class="font-semibold">Acetylcholine</h1>
  {#if profile}
    <p class="text-sm text-muted-foreground">
      {#if modifierLabel}
        Hold <kbd class="rounded border px-1">{modifierLabel}</kbd> and {profile.scanning.trigger} a word to look it up.
      {:else}
        {profile.scanning.trigger === 'hover' ? 'Hover' : 'Click'} a word to look it up.
      {/if}
    </p>
    <p class="text-sm">
      Profile <span class="font-medium">{profile.name}</span> ·
      {dictionaries.length} dictionar{dictionaries.length === 1 ? 'y' : 'ies'}
    </p>
  {/if}
  <div class="flex gap-2">
    <Button class="flex-1" onclick={() => openSettings()}>Settings</Button>
    <Button variant="outline" onclick={() => openSettings('search')}>Search</Button>
  </div>
</div>
