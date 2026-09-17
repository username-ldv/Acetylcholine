<script lang="ts">
import { ACETYLCHOLINE_NAME } from '@acetylcholine/shared';
import { Button } from '$lib/components/ui/button';

let pong = $state<string>('');
let dark = $state(false);

async function ping() {
  const res = (await browser.runtime.sendMessage({ type: 'ping' })) as { at: number };
  pong = new Date(res.at).toLocaleTimeString();
}

$effect(() => {
  document.documentElement.classList.toggle('dark', dark);
});
</script>

<main class="mx-auto max-w-3xl p-8 space-y-6">
  <header class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold tracking-tight">{ACETYLCHOLINE_NAME} settings</h1>
    <Button variant="outline" size="sm" onclick={() => (dark = !dark)}>
      {dark ? 'Light' : 'Dark'} theme
    </Button>
  </header>

  <section class="rounded-lg border p-4 space-y-3">
    <h2 class="font-medium">Scaffold check</h2>
    <p class="text-sm text-muted-foreground">
      Svelte 5, Tailwind 4 and shadcn-svelte are wired up. The button below round-trips a message
      through the background service worker.
    </p>
    <div class="flex items-center gap-3">
      <Button onclick={ping}>Ping background</Button>
      {#if pong}
        <span class="text-sm">pong at {pong}</span>
      {/if}
    </div>
  </section>
</main>
