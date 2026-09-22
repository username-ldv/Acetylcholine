import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/** Origins the Anki integration may ask for (AnkiConnect is usually on 127.0.0.1:8765). */
const ANKI_ORIGINS = ['http://*/*', 'https://*/*'];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  // Manifest V3 on every target (Firefox ≥ 128 is fine with it).
  manifestVersion: 3,
  alias: {
    $lib: 'src/lib',
  },
  dev: {
    // Bind to IPv4 loopback explicitly: Node resolves `localhost` to ::1 only, and the extension
    // pages then cannot reach the dev server (ERR_CONNECTION_REFUSED).
    server: { host: '127.0.0.1', port: 3000 },
  },
  svelte: {
    vite: {
      // Serve Svelte libraries (bits-ui, @lucide/svelte) through the Svelte plugin instead of
      // esbuild pre-bundling: WXT's dev server has no `.svelte` loader in the optimizer.
      prebundleSvelteLibraries: false,
    },
  },
  manifest: ({ browser }) => ({
    name: 'Acetylcholine',
    description:
      'Pop-up dictionary for language learners: hover a word, read its definitions, send it to Anki.',
    permissions: ['storage', 'unlimitedStorage'],
    // AnkiConnect (http://127.0.0.1:8765 by default, URL configurable): the origin is requested
    // with `permissions.request` when Anki integration is switched on, never at install time.
    // Firefox MV3 has no `optional_host_permissions`; its `host_permissions` are optional anyway.
    ...(browser === 'firefox'
      ? { host_permissions: ANKI_ORIGINS }
      : { optional_host_permissions: ANKI_ORIGINS }),
    // The lookup popup page is loaded inside an iframe injected into web pages.
    web_accessible_resources: [
      {
        resources: ['lookup.html', 'assets/*', 'chunks/*'],
        matches: ['<all_urls>'],
      },
    ],
  }),
  vite: () => ({
    plugins: [tailwindcss()],
    worker: { format: 'es' },
  }),
});
