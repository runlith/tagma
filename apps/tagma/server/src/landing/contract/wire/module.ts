import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const landing = {
  id: 'landing',
  title: 'Landing work',
  operations: async () => {
    const [{ LANDING_OPERATIONS }, { CHECKOUT_COMMIT_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operations.js'),
      import('./checkoutCommits.js'),
      import('./refusalWords.js'),
    ]);
    return { declarations: mergeOperations(LANDING_OPERATIONS, CHECKOUT_COMMIT_OPERATIONS), refusals: REFUSAL_WORDS } as const;
  },
} as const satisfies OperationManifest;
