import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { browserGuard } from '@runlith/vite-browser-guard/browserGuard';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const source = process.env.FEED_STAND_SOURCE ?? resolve(root, '../src');

export default defineConfig({
  root,
  plugins: [
    {
      name: 'stand-source',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('/tokens.css')) return code.replace('@source "../src";', `@source "${source}";`);
        if (process.env.FEED_STAND_SOURCE !== undefined && id === resolve(source, 'testing/chatHarness.svelte.ts')) {
          const before = "import { TestClock } from 'effect/testing';";
          if (!code.includes(before)) throw new Error('The c76a2289 baseline fixture TestClock import changed');
          return code.replace(before, "import * as TestClock from 'effect/testing/TestClock';");
        }
        return undefined;
      },
    },
    tailwindcss(),
    svelte({ compilerOptions: { experimental: { async: true } } }),
    browserGuard(),
  ],
  resolve: {
    alias: {
      '@feed': source,
      '@paint': resolve(root, process.env.FEED_STAND_SOURCE === undefined ? 'Markdown.svelte' : 'historical/Markdown.svelte'),
      '@code': resolve(root, process.env.FEED_STAND_SOURCE === undefined ? 'Code.svelte' : 'historical/Code.svelte'),
      '@runlith/markdown/render': resolve(source, '../../../packages/markdown/src/render.ts'),
    },
    dedupe: ['svelte', 'effect'],
    conditions: ['browser', 'svelte', 'module', 'import', 'default'],
  },
  server: { host: '127.0.0.1', port: 5182, strictPort: false, fs: { allow: [resolve(root, '../../..'), source] } },
  worker: { format: 'es' },
  build: { outDir: 'dist', emptyOutDir: true },
});
