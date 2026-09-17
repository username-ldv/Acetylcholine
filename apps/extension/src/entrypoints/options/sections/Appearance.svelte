<script lang="ts">
import type { ReadingDisplay, ResultLayout, Theme } from '@acetylcholine/shared';
import { onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as RadioGroup from '$lib/components/ui/radio-group';
import { Switch } from '$lib/components/ui/switch';
import { listDictionaries } from '$lib/db';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

const profile = $derived(settings.profile);
const popup = $derived(settings.profile.popup);

let installedTags = $state<string[]>([]);

/** Every known reading tag, in the profile's preference order, unknown ones last. */
const readingTags = $derived.by(() => {
  const out = [...profile.readingTags];
  for (const t of installedTags) if (!out.includes(t)) out.push(t);
  return out;
});

const themes: { value: Theme; label: string }[] = [
  { value: 'auto', label: 'Follow system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function moveTag(tag: string, delta: number) {
  const list = [...readingTags];
  const i = list.indexOf(tag);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  profile.readingTags = list;
}

function clampNumber(value: string, min: number, max: number, fallback: number): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

onMount(async () => {
  const dicts = await listDictionaries();
  const tags = new Set<string>();
  for (const d of dicts) for (const t of d.manifest.readingTags) tags.add(t);
  installedTags = [...tags];
});
</script>

<div class="space-y-8">
  <header>
    <h2 class="text-lg font-semibold">Appearance</h2>
    <p class="text-sm text-muted-foreground">Popup layout and readings for profile “{profile.name}”.</p>
  </header>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label>Popup theme</Label>
      <RadioGroup.Root value={popup.theme} onValueChange={(v) => (popup.theme = v as Theme)}>
        {#each themes as t (t.value)}
          <div class="flex items-center gap-2">
            <RadioGroup.Item value={t.value} id="popup-theme-{t.value}" />
            <Label for="popup-theme-{t.value}" class="font-normal">{t.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
    <div class="space-y-2">
      <Label>Settings page theme</Label>
      <RadioGroup.Root
        value={settings.current!.theme}
        onValueChange={(v) => (settings.current!.theme = v as Theme)}
      >
        {#each themes as t (t.value)}
          <div class="flex items-center gap-2">
            <RadioGroup.Item value={t.value} id="page-theme-{t.value}" />
            <Label for="page-theme-{t.value}" class="font-normal">{t.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
  </section>

  <section class="grid gap-6 sm:grid-cols-3">
    <div class="space-y-2">
      <Label for="popup-width">Popup width (px)</Label>
      <Input id="popup-width" type="number" min={200} max={2000} value={popup.width}
        onchange={(e) => (popup.width = Math.round(clampNumber(e.currentTarget.value, 200, 2000, 480)))} />
    </div>
    <div class="space-y-2">
      <Label for="popup-height">Popup max height (px)</Label>
      <Input id="popup-height" type="number" min={150} max={2000} value={popup.height}
        onchange={(e) => (popup.height = Math.round(clampNumber(e.currentTarget.value, 150, 2000, 360)))} />
    </div>
    <div class="space-y-2">
      <Label for="popup-offset">Distance from text (px)</Label>
      <Input id="popup-offset" type="number" min={0} max={100} value={popup.offset}
        onchange={(e) => (popup.offset = Math.round(clampNumber(e.currentTarget.value, 0, 100, 10)))} />
    </div>
  </section>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label for="font-scale">Content font scale</Label>
      <div class="flex items-center gap-3">
        <input
          id="font-scale"
          type="range"
          min="0.5"
          max="3"
          step="0.05"
          class="flex-1"
          value={popup.fontScale}
          oninput={(e) => (popup.fontScale = clampNumber(e.currentTarget.value, 0.5, 3, 1))}
        />
        <span class="w-12 text-right text-sm tabular-nums">{Math.round(popup.fontScale * 100)}%</span>
      </div>
    </div>
    <div class="space-y-4 pt-6">
      <div class="flex items-center gap-3">
        <Switch id="dict-titles" checked={popup.showDictionaryTitles} onCheckedChange={(v) => (popup.showDictionaryTitles = v)} />
        <Label for="dict-titles" class="font-normal">Show dictionary names</Label>
      </div>
    </div>
  </section>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label>Result layout</Label>
      <RadioGroup.Root
        value={profile.resultLayout}
        onValueChange={(v) => (profile.resultLayout = v as ResultLayout)}
      >
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="reading" id="layout-reading" />
          <Label for="layout-reading" class="font-normal">By word and pronunciation</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="dictionary" id="layout-dictionary" />
          <Label for="layout-dictionary" class="font-normal">By dictionary</Label>
        </div>
      </RadioGroup.Root>
      <p class="text-xs text-muted-foreground">
        “By word and pronunciation” makes one card per pronunciation with every dictionary inside.
        “By dictionary” makes one block per word and lists each dictionary's definitions in turn,
        each preceded by its reading.
      </p>
    </div>
    <div class="space-y-2">
      <Label>Readings shown</Label>
      <RadioGroup.Root
        value={profile.readingDisplay}
        onValueChange={(v) => (profile.readingDisplay = v as ReadingDisplay)}
      >
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="primary" id="readings-primary" />
          <Label for="readings-primary" class="font-normal">Primary system only</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="primary-secondary" id="readings-primary-secondary" />
          <Label for="readings-primary-secondary" class="font-normal">Primary large, others small</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroup.Item value="all" id="readings-all" />
          <Label for="readings-all" class="font-normal">All systems alike</Label>
        </div>
      </RadioGroup.Root>
      <p class="text-xs text-muted-foreground">
        Applies to the header readings and to reading-tagged text inside definitions (“all” shows
        every system inline).
      </p>
    </div>
  </section>

  <section class="space-y-2">
    <Label>Reading systems (first available wins)</Label>
    {#if readingTags.length === 0}
      <p class="text-sm text-muted-foreground">Import a dictionary with readings to configure this.</p>
    {:else}
      <ol class="max-w-sm space-y-1" data-testid="reading-tags">
        {#each readingTags as tag, i (tag)}
          <li class="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm">
            <span class="w-5 text-muted-foreground">{i + 1}.</span>
            <span class="flex-1">{tag}</span>
            <Button variant="ghost" size="icon-xs" disabled={i === 0} onclick={() => moveTag(tag, -1)}>↑</Button>
            <Button variant="ghost" size="icon-xs" disabled={i === readingTags.length - 1} onclick={() => moveTag(tag, 1)}>↓</Button>
          </li>
        {/each}
      </ol>
      <p class="text-xs text-muted-foreground">
        The first system in this order that a dictionary offers is its primary system: it leads the
        header and is the one kept in reading-tagged definition text. The other systems follow the
        “Readings shown” choice above.
      </p>
    {/if}
  </section>

  <section class="space-y-2">
    <Label for="custom-css">Custom popup CSS</Label>
    <textarea
      id="custom-css"
      class="min-h-32 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
      placeholder=".ace-headword &#123; color: crimson; &#125;"
      value={popup.customCss}
      onchange={(e) => (popup.customCss = e.currentTarget.value)}
    ></textarea>
    <p class="text-xs text-muted-foreground">
      Applied to the popup document (headers use <code>.ace-headword</code>, <code>.ace-reading</code>,
      <code>.ace-dictionary-title</code>). Per-dictionary CSS lives inside each dictionary's shadow root and
      can be set in a later version.
    </p>
  </section>
</div>
