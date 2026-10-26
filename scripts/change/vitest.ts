import { mergeConfig, type ViteUserConfigExport } from 'vitest/config';

const path = process.env['RUNLITH_CHANGE_CONFIG'];
if (path === undefined) throw new Error('RUNLITH_CHANGE_CONFIG is required');
const loaded = (await import(path)) as { readonly default: ViteUserConfigExport };
const base =
  typeof loaded.default === 'function'
    ? await loaded.default({ command: 'serve', mode: 'test', isSsrBuild: false, isPreview: false })
    : await loaded.default;
export default mergeConfig(base, { test: { setupFiles: [new URL('./testing/trace.ts', import.meta.url).pathname] } });
