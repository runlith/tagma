import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { experimental: { async: true } } })],
  resolve: { conditions: ['browser'] },
  test: {
    isolate: false,
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'jsdom',
    setupFiles: ['@runlith/testbed/vitest/setup', '@runlith/testbed/vitest/jsdom'],
    globalSetup: ['@runlith/testbed/vitest/global'],
    include: ['src/**/*.test.ts', 'src/**/*.test.svelte.ts'],
  },
});
