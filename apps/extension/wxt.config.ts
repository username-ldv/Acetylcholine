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
  }),
});
