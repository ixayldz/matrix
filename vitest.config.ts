import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@matrix/core': resolve(rootDir, 'packages/core/src/index.ts'),
    },
  },
  test: {
    passWithNoTests: true,
  },
});
