<script lang="ts">
import { ACETYLCHOLINE_NAME, ACETYLCHOLINE_VERSION } from '@acetylcholine/shared';
import { Button } from '$lib/components/ui/button';
import { sendBackground } from '$lib/messaging';
import type { SettingsState } from '../settings.svelte';

let { settings }: { settings: SettingsState } = $props();

let pong = $state<string>('');

async function ping() {
  const res = await sendBackground({ type: 'ping' });
  pong = `background v${res.version} answered at ${new Date(res.at).toLocaleTimeString()}`;
}
</script>

<div class="space-y-6">
  <header>
    <h2 class="text-lg font-semibold">About</h2>
    <p class="text-sm text-muted-foreground">{ACETYLCHOLINE_NAME} {ACETYLCHOLINE_VERSION} — a pop-up dictionary for language learners.</p>
  </header>

  <section class="space-y-2 text-sm">
    <p>
      Convert dictionaries with the <code>ace</code> command line tool and import the resulting
      <code>.ace</code> files on the Dictionaries page. Then hold the scan key and hover a word on any page.
    </p>
    <p class="text-muted-foreground">
      Active profile: {settings.profile.name} · language {settings.profile.language} · settings version {settings.current?.version}
    </p>
  </section>

  <section class="flex items-center gap-3">
    <Button variant="outline" onclick={ping}>Ping background</Button>
    {#if pong}<span class="text-sm">{pong}</span>{/if}
  </section>
</div>
