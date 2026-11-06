import adapter from '@sveltejs/adapter-static';
import { windowCompileOptions } from '@tagma/server/views/contract/wire/compile';
import { surfaceOut } from './surfaceOut.js';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: windowCompileOptions,
  kit: {
    outDir: process.env.TAGMA_SURFACE_WORK?.trim() || '.svelte-kit',
    adapter: adapter({ fallback: 'index.html', pages: surfaceOut(), assets: surfaceOut() }),
    serviceWorker: { register: false },
  },
};

export default config;
