<script lang="ts">
import {
  isPopupMessage,
  type LookupResult,
  type PopupInbound,
  type PopupOutbound,
  type PopupProfileOptions,
} from '@acetylcholine/shared';
import { onMount } from 'svelte';
import { sendBackground } from '$lib/messaging';
import Results from '$lib/popup/Results.svelte';
import { applyTheme } from '$lib/popup/theme';
import { Scanner } from '$lib/scanner/scanner';

/** Stack of results; the last one is shown. Nested lookups push, "back" pops. */
let stack = $state<LookupResult[]>([]);
let options = $state<PopupProfileOptions | null>(null);
let loading = $state(false);
let scroller = $state<HTMLDivElement | null>(null);
let customStyle = $state<HTMLStyleElement | null>(null);

const current = $derived(stack[stack.length - 1] ?? null);
const embedded = window.parent !== window;

function post(message: PopupOutbound): void {
  if (embedded) window.parent.postMessage(message, '*');
}

function show(result: LookupResult, opts: PopupProfileOptions): void {
  options = opts;
  stack = [result];
  scrollTop();
}

function scrollTop(): void {
  requestAnimationFrame(() => {
    scroller?.scrollTo({ top: 0 });
  });
}

async function nestedLookup(term: string): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const result = await sendBackground({ type: 'lookup', text: term });
    stack = [...stack, result];
    scrollTop();
  } catch (err) {
    console.warn('[Acetylcholine] nested lookup failed', err);
  } finally {
    loading = false;
  }
}

function back(): void {
  if (stack.length > 1) {
    stack = stack.slice(0, -1);
    scrollTop();
  }
}

function close(): void {
  post({ type: 'acetylcholine:close' });
}

function onMessage(event: MessageEvent): void {
  if (!embedded || event.source !== window.parent) return;
  if (!isPopupMessage(event.data)) return;
  const msg = event.data as PopupInbound;
  switch (msg.type) {
    case 'acetylcholine:show':
      show(msg.result, msg.options);
      break;
    case 'acetylcholine:options':
      options = msg.options;
      break;
    case 'acetylcholine:hidden':
      break;
  }
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'Backspace' && stack.length > 1 && !isEditable(event.target)) {
    event.preventDefault();
    back();
  }
}

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target.tagName))
  );
}

// Theme + custom CSS.
$effect(() => {
  const theme = options?.theme ?? 'auto';
  return applyTheme(theme);
});

$effect(() => {
  if (!customStyle) return;
  customStyle.textContent = options?.customCss ?? '';
});

// Report the content height so the host can size the frame.
onMount(() => {
  const observer = new ResizeObserver(() => {
    post({ type: 'acetylcholine:size', height: Math.ceil(document.documentElement.scrollHeight) });
  });
  observer.observe(document.body);
  window.addEventListener('message', onMessage);
  document.addEventListener('keydown', onKeyDown);
  post({ type: 'acetylcholine:ready' });
  return () => {
    observer.disconnect();
    window.removeEventListener('message', onMessage);
    document.removeEventListener('keydown', onKeyDown);
  };
});

// Scanning inside the popup (hover a word in a definition to look it up).
$effect(() => {
  const opts = options;
  if (!opts?.scanning.scanInsidePopup) return;
  const scanner = new Scanner(
    document,
    { scanning: opts.scanning, language: 'zh' },
    {
      lookup: (text) => sendBackground({ type: 'lookup', text }),
      onHit: (hit) => {
        if (hit.result.matchLength > 0) {
          stack = [...stack, hit.result];
          scrollTop();
        }
      },
      onDismiss: () => {},
      isPopupTarget: () => false,
    },
  );
  scanner.start();
  return () => scanner.stop();
});

// Dev preview: `lookup.html?q=读` renders a lookup without a host page.
onMount(async () => {
  if (embedded) return;
  const q = new URLSearchParams(location.search).get('q');
  const settings = await sendBackground({ type: 'getSettings' });
  const { popupOptionsFromProfile } = await import('$lib/popup/options');
  const { getActiveProfile } = await import('@acetylcholine/shared');
  options = popupOptionsFromProfile(getActiveProfile(settings));
  if (q) stack = [await sendBackground({ type: 'lookup', text: q })];
});
</script>

<svelte:head>
  <style bind:this={customStyle}></style>
</svelte:head>

<div class="flex h-screen flex-col bg-background text-foreground text-[14px]">
  <div class="flex items-center gap-1 border-b px-1.5 py-0.5 text-xs text-muted-foreground select-none">
    <button
      type="button"
      class="rounded px-1.5 py-0.5 hover:bg-muted disabled:opacity-30"
      disabled={stack.length <= 1}
      onclick={back}
      title="Back (Backspace)"
    >
      ←
    </button>
    <span class="flex-1 truncate">
      {#if current}
        {current.groups.length} result{current.groups.length === 1 ? '' : 's'}
        {#if current.elapsed >= 0}
          · {current.elapsed.toFixed(0)} ms{current.cached ? ' (cached)' : ''}
        {/if}
      {:else}
        Acetylcholine
      {/if}
    </span>
    {#if loading}<span class="animate-pulse">…</span>{/if}
    <button
      type="button"
      class="rounded px-1.5 py-0.5 hover:bg-muted"
      onclick={() => sendBackground({ type: 'openOptions' })}
      title="Settings"
    >
      ⚙
    </button>
    {#if embedded}
      <button type="button" class="rounded px-1.5 py-0.5 hover:bg-muted" onclick={close} title="Close (Esc)">
        ✕
      </button>
    {/if}
  </div>
  <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto">
    {#if current && options}
      <Results result={current} {options} onLookup={nestedLookup} />
    {:else}
      <p class="p-3 text-sm text-muted-foreground">Hover a word to look it up.</p>
    {/if}
  </div>
</div>
