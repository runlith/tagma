import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

const CONDITIONS = ['browser', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions: CONDITIONS },
  ssr: { resolve: { conditions: CONDITIONS } },
  plugins: [svelte({ compilerOptions: { experimental: { async: false } } })],
  test: {
    isolate: false,
    experimental: { fsModuleCache: true, fsModuleCachePath: 'node_modules/.vitest-module-cache' },
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['@runlith/testbed/vitest/setup'],
    globalSetup: ['@runlith/testbed/vitest/global'],
  },
});
