<script lang="ts">
import type { ScanModifier, ScanTrigger } from '@acetylcholine/shared';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as RadioGroup from '$lib/components/ui/radio-group';
import { Switch } from '$lib/components/ui/switch';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

const scanning = $derived(settings.profile.scanning);

const modifiers: { value: ScanModifier; label: string }[] = [
  { value: 'shift', label: 'Shift' },
  { value: 'ctrl', label: 'Ctrl (⌘ on macOS)' },
  { value: 'alt', label: 'Alt' },
  { value: 'none', label: 'No key' },
];
const triggers: { value: ScanTrigger; label: string }[] = [
  { value: 'hover', label: 'Hover' },
  { value: 'click', label: 'Click' },
];

function linesToList(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
</script>

<div class="space-y-8">
  <header>
    <h2 class="text-lg font-semibold">Scanning</h2>
    <p class="text-sm text-muted-foreground">How text on web pages is scanned for profile “{settings.profile.name}”.</p>
  </header>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label>Trigger</Label>
      <RadioGroup.Root
        value={scanning.trigger}
        onValueChange={(v) => (scanning.trigger = v as ScanTrigger)}
      >
        {#each triggers as t (t.value)}
          <div class="flex items-center gap-2">
            <RadioGroup.Item value={t.value} id="trigger-{t.value}" />
            <Label for="trigger-{t.value}" class="font-normal">{t.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
    <div class="space-y-2">
      <Label>Key to hold</Label>
      <RadioGroup.Root
        value={scanning.modifier}
        onValueChange={(v) => (scanning.modifier = v as ScanModifier)}
      >
        {#each modifiers as m (m.value)}
          <div class="flex items-center gap-2">
            <RadioGroup.Item value={m.value} id="modifier-{m.value}" />
            <Label for="modifier-{m.value}" class="font-normal">{m.label}</Label>
          </div>
        {/each}
      </RadioGroup.Root>
    </div>
  </section>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label for="scan-length">Scan length (characters)</Label>
      <Input
        id="scan-length"
        type="number"
        min={1}
        max={64}
        value={scanning.scanLength}
        onchange={(e) => (scanning.scanLength = clampInt(e.currentTarget.value, 1, 64, 16))}
      />
      <p class="text-xs text-muted-foreground">Longest word that can be matched from the cursor.</p>
    </div>
    <div class="space-y-2">
      <Label for="scan-delay">Delay (ms)</Label>
      <Input
        id="scan-delay"
        type="number"
        min={0}
        max={2000}
        value={scanning.delay}
        onchange={(e) => (scanning.delay = clampInt(e.currentTarget.value, 0, 2000, 20))}
      />
      <p class="text-xs text-muted-foreground">How long the cursor must rest before scanning.</p>
    </div>
  </section>

  <section class="space-y-4">
    <div class="flex items-center gap-3">
      <Switch id="scan-inside" checked={scanning.scanInsidePopup} onCheckedChange={(v) => (scanning.scanInsidePopup = v)} />
      <Label for="scan-inside" class="font-normal">Scan text inside the popup (nested lookups)</Label>
    </div>
    <div class="flex items-center gap-3">
      <Switch id="close-scroll" checked={scanning.closeOnScroll} onCheckedChange={(v) => (scanning.closeOnScroll = v)} />
      <Label for="close-scroll" class="font-normal">Close the popup when the page scrolls</Label>
    </div>
  </section>

  <section class="grid gap-6 sm:grid-cols-2">
    <div class="space-y-2">
      <Label for="excluded-sites">Excluded sites</Label>
      <textarea
        id="excluded-sites"
        class="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
        placeholder={'example.com\n*.wikipedia.org'}
        value={scanning.excludedSites.join('\n')}
        onchange={(e) => (scanning.excludedSites = linesToList(e.currentTarget.value))}
      ></textarea>
      <p class="text-xs text-muted-foreground">One host per line; <code>*.</code> matches subdomains.</p>
    </div>
    <div class="space-y-2">
      <Label for="ignore-selectors">Ignored elements</Label>
      <textarea
        id="ignore-selectors"
        class="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
        placeholder={'.no-lookup\nnav'}
        value={scanning.ignoreSelectors.join('\n')}
        onchange={(e) => (scanning.ignoreSelectors = linesToList(e.currentTarget.value))}
      ></textarea>
      <p class="text-xs text-muted-foreground">CSS selectors, one per line. Text inside them is never scanned.</p>
    </div>
  </section>
</div>
