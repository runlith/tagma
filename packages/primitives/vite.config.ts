import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const CONDITIONS = ['browser', 'module', 'node', 'development|production'];
const isolatedUnit = ['src/float.test.ts', 'src/OverlayLayers.test.ts'];

export default defineConfig({
  resolve: { conditions: CONDITIONS },
  ssr: { resolve: { conditions: CONDITIONS } },
  plugins: [svelte({ compilerOptions: { dev: true, experimental: { async: true } } })],
  test: {
    environment: 'jsdom',
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: isolatedUnit, isolate: false } },
      { extends: true, test: { name: 'unit-isolated', include: isolatedUnit, isolate: true } },
    ],
    setupFiles: ['@runlith/testbed/vitest/setup', '@runlith/testbed/vitest/jsdom'],
    globalSetup: ['@runlith/testbed/vitest/global'],
  },
});
