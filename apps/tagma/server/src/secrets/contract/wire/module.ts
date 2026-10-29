import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const secrets = {
  id: 'secrets',
  title: 'Secrets',
  operations: async () => {
    const [{ SECRET_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: SECRET_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
