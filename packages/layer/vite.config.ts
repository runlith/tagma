import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const CONDITIONS = ['browser', 'module', 'node', 'development|production'];

const sveltekitModules: Plugin = {
  name: 'sveltekit-modules-for-mocks',
  resolveId: (id) => (id.startsWith('$app/') ? `\0${id}` : undefined),
  load: (id) => (id.startsWith('\0$app/') ? 'export {};' : undefined),
};

export default defineConfig({
  resolve: {
    conditions: CONDITIONS,
    alias: [{ find: '$app', replacement: fileURLToPath(new URL('./node_modules/@sveltejs/kit/src/runtime/app', import.meta.url)) }],
  },
  ssr: { resolve: { conditions: CONDITIONS } },
  plugins: [sveltekitModules, svelte({ compilerOptions: { dev: true, experimental: { async: false } } })],
  test: {
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'jsdom',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/cookies.test.ts', 'src/sveltekit/index.test.ts', 'src/sveltekit/ssr.test.ts'],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'unit-isolated',
          include: ['src/cookies.test.ts', 'src/sveltekit/index.test.ts', 'src/sveltekit/ssr.test.ts'],
          isolate: true,
        },
      },
    ],
    setupFiles: ['@runlith/testbed/vitest/setup', '@runlith/testbed/vitest/jsdom'],
    globalSetup: ['@runlith/testbed/vitest/global'],
  },
});
