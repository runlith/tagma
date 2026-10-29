import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const plugins = {
  id: 'plugins',
  title: 'Plugins',
  operations: async () => {
    const [{ PLUGIN_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: PLUGIN_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
