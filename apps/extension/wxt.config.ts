import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

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
  manifest: {
    name: 'Acetylcholine',
    description:
      'Pop-up dictionary for language learners: hover a word, read its definitions, send it to Anki.',
    permissions: ['storage', 'unlimitedStorage'],
    // The lookup popup page is loaded inside an iframe injected into web pages.
    web_accessible_resources: [
      {
        resources: ['lookup.html', 'assets/*', 'chunks/*'],
        matches: ['<all_urls>'],
      },
    ],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    worker: { format: 'es' },
  }),
});
