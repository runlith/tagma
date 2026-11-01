import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import app from './svelte.config.js';

const isolatedUnit = [
  'src/lib/app/chrome/projectSwitch.svelte.test.ts',
  'src/lib/features/browser/view/NativeView.svelte.test.ts',
  'src/lib/features/checkout/DiffStage.svelte.test.ts',
  'src/lib/features/executions/terminal/Divider.svelte.test.ts',
  'src/lib/features/graph/block/Body.svelte.test.ts',
  'src/lib/features/executions/terminal/Pane.svelte.test.ts',
  'src/lib/features/executions/terminal/PaneTree.close.svelte.test.ts',
  'src/lib/features/executions/terminal/Views.svelte.test.ts',
  'src/lib/features/speech/viewSpeech.test.ts',
  'src/lib/features/calls/TranscriptView.svelte.test.ts',
  'src/lib/features/calls/viewCalls.test.ts',
  'src/lib/features/calls/moment.svelte.test.ts',
  'src/lib/features/views/ViewBridge.test.ts',
  'src/lib/features/threads/ThreadSlot.open.svelte.test.ts',
  'src/lib/features/threads/Column.svelte.test.ts',
  'src/lib/features/threads/ColumnWindow.svelte.test.ts',
  'src/lib/features/worktrees/Window.svelte.test.ts',
];

export default defineConfig({
  root: import.meta.dirname,
  plugins: [svelte({ configFile: false, compilerOptions: app.compilerOptions })],
  resolve: {
    alias: { $lib: resolve(import.meta.dirname, 'src/lib') },
    conditions: ['module', 'browser', 'development|production'],
  },
  test: {
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'node',
    setupFiles: ['@runlith/testbed/vitest/setup', '@runlith/testbed/vitest/jsdom'],
    globalSetup: ['@runlith/testbed/vitest/global'],
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: isolatedUnit, isolate: false } },
      { extends: true, test: { name: 'unit-isolated', include: isolatedUnit, isolate: true } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.itest.ts'],
          environment: 'jsdom',
          isolate: false,
        },
      },
    ],
  },
});
