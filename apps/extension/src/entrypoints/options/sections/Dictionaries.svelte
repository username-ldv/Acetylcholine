<script lang="ts">
import { type DictionaryPreference, resolveDictionaryPreferences } from '@acetylcholine/shared';
import { onDestroy, onMount } from 'svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import { Progress } from '$lib/components/ui/progress';
import { Switch } from '$lib/components/ui/switch';
import {
  type DictionaryRecord,
  deleteDictionary,
  listDictionaries,
  type StorageEstimate,
  storageEstimate,
} from '$lib/db';
import { formatBytes, formatCount, formatDate } from '$lib/format';
import { type ImportJob, ImportQueue } from '$lib/import/queue.svelte';
import { sendBackground } from '$lib/messaging';
import { clearPreparedStyles } from '$lib/popup/content-host';
import { clearDictionaryStyles } from '$lib/popup/dictionary-styles';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

let dictionaries = $state<DictionaryRecord[]>([]);
let estimate = $state<StorageEstimate | null>(null);
let dragging = $state(false);
let expanded = $state<Set<string>>(new Set());
let pendingDelete = $state<DictionaryRecord | null>(null);
let deleting = $state(false);
let fileInput = $state<HTMLInputElement | null>(null);

const queue = new ImportQueue(onImportFinished);

const prefs = $derived(
  resolveDictionaryPreferences(
    settings.profile,
    dictionaries.map((d) => d.id),
  ),
);
const byId = $derived(new Map(dictionaries.map((d) => [d.id, d])));
const totalSize = $derived(dictionaries.reduce((sum, d) => sum + d.fileSize, 0));

async function refresh() {
  [dictionaries, estimate] = await Promise.all([listDictionaries(), storageEstimate()]);
}

async function onImportFinished(job: ImportJob) {
  if (job.status === 'done') {
    clearDictionaryStyles();
    clearPreparedStyles();
    await refresh();
    await sendBackground({ type: 'dictionariesChanged' });
  }
}

function pickFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return [...list].filter((f) => /\.ace$/i.test(f.name));
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  dragging = false;
  const files = pickFiles(event.dataTransfer?.files);
  if (files.length > 0) queue.add(files);
}

function onFileChange(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const files = pickFiles(input.files);
  if (files.length > 0) queue.add(files);
  input.value = '';
}

function writePrefs(next: DictionaryPreference[]) {
  settings.profile.dictionaries = next.map((p) => ({ ...p }));
}

function setEnabled(id: string, enabled: boolean) {
  writePrefs(prefs.map((p) => (p.id === id ? { ...p, enabled } : p)));
}

function move(id: string, delta: number) {
  const list = [...prefs];
  const i = list.findIndex((p) => p.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  writePrefs(list);
}

function toggleExpanded(id: string) {
  const next = new Set(expanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded = next;
}

async function confirmDelete() {
  if (!pendingDelete) return;
  deleting = true;
  try {
    const id = pendingDelete.id;
    await deleteDictionary(id);
    for (const profile of settings.current?.profiles ?? []) {
      profile.dictionaries = profile.dictionaries.filter((p) => p.id !== id);
    }
    clearDictionaryStyles();
    clearPreparedStyles();
    await refresh();
    await sendBackground({ type: 'dictionariesChanged' });
  } finally {
    deleting = false;
    pendingDelete = null;
  }
}

function stageLabel(job: ImportJob): string {
  const p = job.progress;
  if (!p) return job.status === 'queued' ? 'Waiting…' : 'Starting…';
  const names: Record<string, string> = {
    open: 'Opening',
    entries: 'Entries',
    keys: 'Keys',
    meta: 'Frequencies',
    tags: 'Tags',
    kanji: 'Characters',
    kanjiMeta: 'Character data',
    assets: 'Assets',
    finish: 'Finishing',
  };
  const name = names[p.stage] ?? p.stage;
  return p.total > 1 ? `${name} ${formatCount(p.current)} / ${formatCount(p.total)}` : name;
}

function stagePercent(job: ImportJob): number {
  const p = job.progress;
  if (!p || p.total === 0) return 0;
  return Math.round((p.current / p.total) * 100);
}

onMount(() => {
  void refresh();
});
onDestroy(() => queue.dispose());
</script>

<div class="space-y-8">
  <header>
    <h2 class="text-lg font-semibold">Dictionaries</h2>
    <p class="text-sm text-muted-foreground">
      Import <code>.ace</code> files produced by the <code>ace convert</code> command. Enable, order
      and remove dictionaries for the active profile ({settings.profile.name}).
    </p>
  </header>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <section
    class="rounded-lg border-2 border-dashed p-8 text-center transition-colors {dragging
      ? 'border-primary bg-muted'
      : 'border-border'}"
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
    data-testid="dropzone"
  >
    <p class="mb-3 text-sm">Drop <code>.ace</code> files here</p>
    <input
      bind:this={fileInput}
      type="file"
      accept=".ace,application/zip"
      multiple
      class="hidden"
      onchange={onFileChange}
      data-testid="file-input"
    />
    <Button variant="outline" onclick={() => fileInput?.click()}>Choose files…</Button>
  </section>

  {#if queue.jobs.length > 0}
    <section class="space-y-3" data-testid="import-jobs">
      <div class="flex items-center justify-between">
        <h3 class="font-medium">Imports</h3>
        {#if !queue.busy}
          <Button variant="ghost" size="sm" onclick={() => queue.clearFinished()}>Clear</Button>
        {/if}
      </div>
      {#each queue.jobs as job (job.id)}
        <div class="rounded-md border p-3 text-sm" data-status={job.status}>
          <div class="flex items-center gap-3">
            <span class="min-w-0 flex-1 truncate font-medium">
              {job.title || job.fileName}
              <span class="ml-1 text-xs text-muted-foreground">({formatBytes(job.fileSize)})</span>
            </span>
            {#if job.status === 'done'}
              <Badge>Imported</Badge>
            {:else if job.status === 'error'}
              <Badge variant="destructive">Failed</Badge>
            {:else if job.status === 'cancelled'}
              <Badge variant="secondary">Cancelled</Badge>
            {:else}
              <span class="text-xs text-muted-foreground">{stageLabel(job)}</span>
              <Button variant="ghost" size="xs" onclick={() => queue.cancel(job.id)}>Cancel</Button>
            {/if}
          </div>
          {#if job.status === 'running' || job.status === 'queued'}
            <Progress class="mt-2" value={stagePercent(job)} />
          {:else if job.status === 'error'}
            <p class="mt-1 text-xs text-destructive">{job.error}</p>
          {:else if job.status === 'done' && job.finishedAt}
            <p class="mt-1 text-xs text-muted-foreground">
              {((job.finishedAt - job.startedAt) / 1000).toFixed(1)} s
            </p>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  <section class="space-y-3">
    <div class="flex items-baseline justify-between">
      <h3 class="font-medium">Installed ({dictionaries.length})</h3>
      <p class="text-xs text-muted-foreground" data-testid="storage">
        {formatBytes(totalSize)} of dictionaries
        {#if estimate}
          · {formatBytes(estimate.usage)} used of {formatBytes(estimate.quota)} available
        {/if}
      </p>
    </div>

    {#if dictionaries.length === 0}
      <p class="text-sm text-muted-foreground">No dictionaries yet.</p>
    {/if}

    <ul class="space-y-2" data-testid="dictionary-list">
      {#each prefs as pref, i (pref.id)}
        {@const dict = byId.get(pref.id)}
        {#if dict}
          {@const m = dict.manifest}
          <li class="rounded-lg border p-3" data-dictionary={dict.id} data-enabled={pref.enabled}>
            <div class="flex items-center gap-3">
              <Switch checked={pref.enabled} onCheckedChange={(v) => setEnabled(dict.id, v)} />
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="font-medium">{m.title}</span>
                  <span class="text-xs text-muted-foreground">rev {m.revision}</span>
                  {#if dict.status !== 'ready'}
                    <Badge variant="destructive">incomplete</Badge>
                  {/if}
                </div>
                <div class="text-xs text-muted-foreground">
                  {formatCount(m.counts.entries)} entries · {formatCount(m.counts.keys)} keys
                  {#if m.counts.assets > 0}· {formatCount(m.counts.assets)} assets{/if}
                  · {formatBytes(dict.fileSize)}
                  {#if m.readingTags.length > 0}· readings: {m.readingTags.join(', ')}{/if}
                </div>
              </div>
              <div class="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" title="Move up" disabled={i === 0} onclick={() => move(dict.id, -1)}>↑</Button>
                <Button variant="ghost" size="icon-sm" title="Move down" disabled={i === prefs.length - 1} onclick={() => move(dict.id, 1)}>↓</Button>
                <Button variant="ghost" size="sm" onclick={() => toggleExpanded(dict.id)}>
                  {expanded.has(dict.id) ? 'Hide' : 'Details'}
                </Button>
                <Button variant="destructive" size="sm" onclick={() => (pendingDelete = dict)}>Delete</Button>
              </div>
            </div>
            {#if expanded.has(dict.id)}
              <dl class="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                <dt class="text-muted-foreground">Id</dt>
                <dd class="font-mono break-all">{m.id}</dd>
                {#if m.author}<dt class="text-muted-foreground">Author</dt><dd>{m.author}</dd>{/if}
                {#if m.attribution}<dt class="text-muted-foreground">Attribution</dt><dd>{m.attribution}</dd>{/if}
                {#if m.description}<dt class="text-muted-foreground">Description</dt><dd class="whitespace-pre-wrap">{m.description}</dd>{/if}
                {#if m.url}<dt class="text-muted-foreground">URL</dt><dd><a class="underline" href={m.url} target="_blank" rel="noreferrer">{m.url}</a></dd>{/if}
                <dt class="text-muted-foreground">Languages</dt>
                <dd>{m.sourceLanguage ?? '?'} → {m.targetLanguage ?? '?'}</dd>
                <dt class="text-muted-foreground">Source</dt>
                <dd>{m.source.format} · generated by {m.generator}</dd>
                <dt class="text-muted-foreground">Content</dt>
                <dd>{m.contentKinds.join(', ')}{dict.styles ? ' · has stylesheet' : ''}</dd>
                <dt class="text-muted-foreground">Counts</dt>
                <dd>
                  {formatCount(m.counts.entries)} entries, {formatCount(m.counts.keys)} keys,
                  {formatCount(m.counts.meta)} meta, {formatCount(m.counts.tags)} tags,
                  {formatCount(m.counts.kanji)} characters, {formatCount(m.counts.assets)} assets
                </dd>
                <dt class="text-muted-foreground">Imported</dt>
                <dd>{formatDate(dict.importedAt)}</dd>
              </dl>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  </section>
</div>

<AlertDialog.Root open={pendingDelete !== null} onOpenChange={(open) => { if (!open) pendingDelete = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{pendingDelete?.manifest.title}”?</AlertDialog.Title>
      <AlertDialog.Description>
        This removes the dictionary and its {formatCount(pendingDelete?.manifest.counts.entries ?? 0)}
        entries from the browser. You can import the <code>.ace</code> file again later.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action disabled={deleting} onclick={confirmDelete}>
        {deleting ? 'Deleting…' : 'Delete'}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
