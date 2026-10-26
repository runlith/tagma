import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const checkoutFiles = {
  id: 'checkout-files',
  title: "The operator's files of a checkout",
  operations: async () => {
    const [{ FILE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: FILE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
