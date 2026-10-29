import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const marketplaces = {
  id: 'marketplaces',
  title: 'Marketplaces',
  operations: async () => {
    const [{ MARKETPLACE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: MARKETPLACE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
