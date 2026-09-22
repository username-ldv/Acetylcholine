<script lang="ts">
import { ANKI_MARKERS, type AnkiStatus } from '@acetylcholine/shared';
import { onMount } from 'svelte';
import { requestOriginPermission } from '$lib/anki/permissions';
import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as RadioGroup from '$lib/components/ui/radio-group';
import * as Select from '$lib/components/ui/select';
import { Switch } from '$lib/components/ui/switch';
import { sendBackground } from '$lib/messaging';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

const anki = $derived(settings.current!.anki);

let status = $state<AnkiStatus | null>(null);
let decks = $state<string[]>([]);
let models = $state<string[]>([]);
let fieldNames = $state<string[]>([]);
let busy = $state(false);
let error = $state<string | null>(null);
/** Field whose input was edited last; marker chips append to it. */
let activeField = $state<string | null>(null);

const MARKER_EXAMPLE = '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}';

/** A starting template for a field the user has not filled in, guessed from its name. */
function suggestTemplate(field: string): string {
  const f = field.toLowerCase();
  if (/^(word|expression|term|vocab|headword)/.test(f)) return '{expression}';
  if (/reading|pinyin|zhuyin|pronunciation/.test(f)) return '{reading}';
  if (/definition|glossary|meaning/.test(f)) return '{glossary}';
  if (/^sentence$|^context$|^example/.test(f)) return '{sentence}';
  if (/^url$|^source$/.test(f)) return '{url}';
  return '';
}

async function refresh(): Promise<void> {
  busy = true;
  error = null;
  try {
    status = await sendBackground({ type: 'anki:status' });
    if (status.connected) {
      [decks, models] = await Promise.all([
        sendBackground({ type: 'anki:decks' }),
        sendBackground({ type: 'anki:models' }),
      ]);
      if (anki.model) await loadFields(anki.model);
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    busy = false;
  }
}

/** Loads the note type's fields and keeps `anki.fields` in that order, existing templates kept. */
async function loadFields(model: string): Promise<void> {
  fieldNames = await sendBackground({ type: 'anki:modelFields', model });
  const next: Record<string, string> = {};
  for (const f of fieldNames) next[f] = anki.fields[f] ?? '';
  anki.fields = next;
}

async function setEnabled(on: boolean): Promise<void> {
  error = null;
  if (!on) {
    anki.enabled = false;
    status = null;
    return;
  }
  try {
    const { granted, origin } = await requestOriginPermission(anki.url);
    if (!granted) {
      error = `Access to ${origin} was not granted; the browser needs it to reach AnkiConnect.`;
      return;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return;
  }
  anki.enabled = true;
  // The background reads the stored settings: save now instead of after the autosave delay.
  await settings.save($state.snapshot(settings.current!));
  await refresh();
}

async function chooseModel(model: string): Promise<void> {
  if (!model) return;
  anki.model = model;
  try {
    await loadFields(model);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    return;
  }
  for (const f of fieldNames) {
    if (anki.fields[f]) continue;
    const suggestion = suggestTemplate(f);
    if (suggestion) anki.fields[f] = suggestion;
  }
}

function insertMarker(marker: string): void {
  const field = activeField ?? fieldNames[0];
  if (!field) return;
  anki.fields[field] = (anki.fields[field] ?? '') + marker;
}

function tagsFromText(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

onMount(() => {
  if (anki.enabled) void refresh();
});
</script>

<div class="space-y-8">
  <header>
    <h2 class="text-lg font-semibold">Anki</h2>
    <p class="text-sm text-muted-foreground">
      Send words to Anki through the AnkiConnect add-on. A note is built from one result in the popup:
      the word's forms, readings, definitions and the sentence it was found in.
    </p>
  </header>

  <section class="space-y-4">
    <div class="flex items-center gap-3">
      <Switch id="anki-enabled" checked={anki.enabled} onCheckedChange={(v) => void setEnabled(v)} />
      <Label for="anki-enabled" class="font-normal">Enable Anki integration</Label>
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="anki-url">AnkiConnect URL</Label>
        <Input
          id="anki-url"
          value={anki.url}
          onchange={(e) => (anki.url = e.currentTarget.value.trim() || 'http://127.0.0.1:8765')}
        />
      </div>
      <div class="space-y-2">
        <Label for="anki-key">API key (only if AnkiConnect requires one)</Label>
        <Input id="anki-key" type="password" value={anki.key} onchange={(e) => (anki.key = e.currentTarget.value)} />
      </div>
    </div>
    <div class="flex items-center gap-3 text-sm" data-testid="anki-status">
      <Button variant="outline" size="sm" disabled={busy || !anki.enabled} onclick={() => void refresh()}>
        {busy ? 'Checking…' : 'Test connection'}
      </Button>
      {#if !anki.enabled}
        <span class="text-muted-foreground">Disabled</span>
      {:else if status?.connected}
        <span class="text-green-600" data-connected="true">Connected (AnkiConnect v{status.version})</span>
      {:else if status?.error}
        <span class="text-destructive">{status.error}</span>
      {/if}
    </div>
    {#if error}
      <p class="text-sm text-destructive">{error}</p>
    {/if}
  </section>

  {#if anki.enabled && status?.connected}
    <section class="grid gap-6 sm:grid-cols-2">
      <div class="space-y-2">
        <Label>Deck</Label>
        <Select.Root type="single" value={anki.deck} onValueChange={(v) => (anki.deck = v)}>
          <Select.Trigger class="w-full" data-testid="anki-deck">{anki.deck || 'Choose a deck'}</Select.Trigger>
          <Select.Content>
            {#each decks as d (d)}
              <Select.Item value={d} label={d} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="space-y-2">
        <Label>Note type</Label>
        <Select.Root type="single" value={anki.model} onValueChange={(v) => void chooseModel(v)}>
          <Select.Trigger class="w-full" data-testid="anki-model">{anki.model || 'Choose a note type'}</Select.Trigger>
          <Select.Content>
            {#each models as m (m)}
              <Select.Item value={m} label={m} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </section>

    {#if anki.model && fieldNames.length > 0}
      <section class="space-y-3">
        <Label>Fields of “{anki.model}”</Label>
        <div class="space-y-2" data-testid="anki-fields">
          {#each fieldNames as field (field)}
            <div class="grid grid-cols-[10rem_1fr] items-center gap-3">
              <span class="truncate text-sm" title={field}>{field}</span>
              <Input
                value={anki.fields[field] ?? ''}
                placeholder="(left empty)"
                class="font-mono text-sm"
                data-field={field}
                onfocus={() => (activeField = field)}
                oninput={(e) => (anki.fields[field] = e.currentTarget.value)}
              />
            </div>
          {/each}
        </div>
        <div class="flex flex-wrap gap-1.5">
          {#each ANKI_MARKERS as m (m.name)}
            <button
              type="button"
              class="rounded-md border px-1.5 py-0.5 font-mono text-xs hover:bg-muted"
              title={m.description}
              onclick={() => insertMarker(m.name)}
            >
              {m.name}
            </button>
          {/each}
        </div>
        <p class="text-xs text-muted-foreground">
          Click a marker to append it to the field you edited last. A field may mix text, HTML and
          markers, e.g. <code>{MARKER_EXAMPLE}</code>. Anki needs the first field filled and treats
          notes with the same first field as duplicates.
        </p>
      </section>
    {/if}

    <section class="grid gap-6 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="anki-tags">Tags</Label>
        <Input
          id="anki-tags"
          value={anki.tags.join(' ')}
          onchange={(e) => (anki.tags = tagsFromText(e.currentTarget.value))}
        />
        <p class="text-xs text-muted-foreground">Separated by spaces.</p>
      </div>
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <Switch
            id="anki-check-dup"
            checked={anki.checkDuplicates}
            onCheckedChange={(v) => (anki.checkDuplicates = v)}
          />
          <Label for="anki-check-dup" class="font-normal">Look for existing notes before adding</Label>
        </div>
        <RadioGroup.Root
          value={anki.duplicateScope}
          onValueChange={(v) => (anki.duplicateScope = v as 'collection' | 'deck')}
          class="ml-1"
        >
          <div class="flex items-center gap-2">
            <RadioGroup.Item value="collection" id="dup-collection" />
            <Label for="dup-collection" class="font-normal">in the whole collection</Label>
          </div>
          <div class="flex items-center gap-2">
            <RadioGroup.Item value="deck" id="dup-deck" />
            <Label for="dup-deck" class="font-normal">in the chosen deck only</Label>
          </div>
        </RadioGroup.Root>
        <div class="flex items-center gap-3">
          <Switch
            id="anki-allow-dup"
            checked={anki.allowDuplicates}
            onCheckedChange={(v) => (anki.allowDuplicates = v)}
          />
          <Label for="anki-allow-dup" class="font-normal">Allow adding a duplicate anyway</Label>
        </div>
      </div>
    </section>

    <section class="space-y-2">
      <div class="flex items-center gap-3">
        <Switch
          id="anki-glossary-styles"
          checked={anki.glossaryStyles}
          onCheckedChange={(v) => (anki.glossaryStyles = v)}
        />
        <Label for="anki-glossary-styles" class="font-normal">Style the glossary like the popup</Label>
      </div>
      <p class="text-xs text-muted-foreground">
        Each dictionary's stylesheet is stored once in Anki's media folder as
        <code>_ace-&lt;dictionary&gt;.css</code>, confined to the glossary, and linked from
        <code>{'{glossary}'}</code>. Fonts bundled with a dictionary are not exported. Turn this off
        if you style definitions in the card template yourself.
      </p>
    </section>
  {/if}
</div>
