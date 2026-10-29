import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const tagmaApps = {
  id: 'tagma-apps',
  title: 'Apps',
  operations: async () => {
    const [{ TAGMA_APP_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: TAGMA_APP_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
