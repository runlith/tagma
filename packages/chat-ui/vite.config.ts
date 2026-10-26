import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const isolatedUnit = [
  'src/ChatSurface.escape.svelte.test.ts',
  'src/ChatSurface.stalled.svelte.test.ts',
  'src/ChatSurface.still.svelte.test.ts',
  'src/Composer.svelte.test.ts',
  'src/FeedRegions.svelte.test.ts',
  'src/PinnedRegion.svelte.test.ts',
  'src/TranscriptViewport.svelte.test.ts',
  'src/TranscriptVirtualizer.svelte.test.ts',
  'src/entries/ToolDiff.svelte.test.ts',
];

export default defineConfig({
  plugins: [svelte({ compilerOptions: { experimental: { async: true } } })],
  test: {
    environment: 'jsdom',
    setupFiles: ['@runlith/testbed/vitest/setup', '@runlith/testbed/vitest/jsdom'],
    globalSetup: ['@runlith/testbed/vitest/global'],
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: isolatedUnit, isolate: false } },
      { extends: true, test: { name: 'unit-isolated', include: isolatedUnit, isolate: true, sequence: { groupOrder: 1 } } },
      {
        extends: true,
        test: { name: 'bench', include: ['src/**/*.bench.ts'], environment: 'node', sequence: { groupOrder: 2 } },
      },
    ],
  },
  resolve: { conditions: ['module', 'browser', 'development|production'] },
});
