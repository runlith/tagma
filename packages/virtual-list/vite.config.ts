import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const isolatedUnit = ['src/touchTail.test.ts'];

export default defineConfig({
  plugins: [svelte({ compilerOptions: { experimental: { async: false } } })],
  test: {
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'node',
    setupFiles: ['@runlith/testbed/vitest/setup'],
    globalSetup: ['@runlith/testbed/vitest/global'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: isolatedUnit, isolate: false } },
      { extends: true, test: { name: 'unit-isolated', include: isolatedUnit, isolate: true } },
    ],
  },
});
