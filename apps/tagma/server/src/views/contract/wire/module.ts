import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const views = {
  id: 'views',
  title: 'Plugin views',
  operations: async () => {
    const [{ VIEW_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: VIEW_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
