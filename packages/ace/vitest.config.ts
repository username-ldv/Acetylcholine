import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { name: 'ace', include: ['test/**/*.test.ts'] },
});
