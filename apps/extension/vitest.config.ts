import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
  },
  test: {
    name: 'extension',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['fake-indexeddb/auto'],
  },
});
