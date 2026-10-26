import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const navigation = {
  id: 'navigation',
  title: 'Code navigation',
  operations: async () => {
    const [{ NAVIGATION_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: NAVIGATION_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
