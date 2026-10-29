import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ compilerOptions: { experimental: { async: true } } })],
  test: {
    isolate: false,
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['@runlith/testbed/vitest/setup'],
    globalSetup: ['@runlith/testbed/vitest/global'],
  },
});
