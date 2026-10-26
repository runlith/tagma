import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte({ compilerOptions: { experimental: { async: true } } })],
  server: { port: 5181, strictPort: false },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        stand: fileURLToPath(new URL('./index.html', import.meta.url)),
        probe: fileURLToPath(new URL('./probe.html', import.meta.url)),
      },
    },
  },
});
