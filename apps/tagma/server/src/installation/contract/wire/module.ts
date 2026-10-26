import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const installation = {
  id: 'installation',
  title: 'This installation',
  operations: async () => {
    const [{ INSTALLATION_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: INSTALLATION_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
