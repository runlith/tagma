import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const worktrees = {
  id: 'worktrees',
  title: 'Worktrees',
  operations: async () => {
    const [{ CREATION_OPERATIONS }, { LISTING_OPERATIONS }, { RETIREMENT_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operations/creation.js'),
      import('./operations/listing.js'),
      import('./operations/retirement.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(CREATION_OPERATIONS, LISTING_OPERATIONS, RETIREMENT_OPERATIONS),
      refusals: REFUSAL_WORDS,
    } as const;
  },
} as const satisfies OperationManifest;
