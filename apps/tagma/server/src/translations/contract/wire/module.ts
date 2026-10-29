import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const translations = {
  id: 'translations',
  title: 'Block translations',
  operations: async () => {
    const [{ TRANSLATION_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: TRANSLATION_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
