import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const providers = {
  id: 'providers',
  title: 'Provider accounts',
  operations: async () => {
    const [{ PROVIDER_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: PROVIDER_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
