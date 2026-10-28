import adapter from '@sveltejs/adapter-static';
import { surfaceOut } from './surfaceOut.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
    experimental: { async: false },
  },
  kit: {
    outDir: process.env.TAGMA_SURFACE_WORK?.trim() || '.svelte-kit',
    adapter: adapter({ fallback: 'index.html', pages: surfaceOut(), assets: surfaceOut() }),
    serviceWorker: { register: false },
  },
};

export default config;
