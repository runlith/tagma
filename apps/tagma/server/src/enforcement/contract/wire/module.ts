import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const enforcement = {
  id: 'enforcement',
  title: 'Rule enforcement',
  operations: async () => {
    const [{ ENFORCEMENT_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operationCatalog.js'),
      import('./refusalWords.js'),
    ]);
    return { declarations: ENFORCEMENT_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
