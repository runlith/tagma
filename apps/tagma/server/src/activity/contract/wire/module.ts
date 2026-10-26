import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const activity = {
  id: 'activity',
  title: 'What the product did',
  operations: async () => {
    const [{ ACTIVITY_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: ACTIVITY_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
