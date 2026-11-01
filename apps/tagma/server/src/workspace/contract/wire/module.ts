import { mergeOperations, type WireModule } from '../../../platform/contract/wire/manifest.js';
import { CHECKOUT_FEED } from './checkout.js';

export const workspace = {
  id: 'workspace',
  title: 'Checkouts of a registered Git store',
  operations: async () => {
    const [{ CHECKOUT_OPERATIONS }, { CHECKOUT_ACT_OPERATIONS }, { WORKING_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./checkoutReads.js'),
      import('./checkoutActs.js'),
      import('./repositoryReads.js'),
      import('./refusalWords.js'),
    ]);
    return {
      declarations: mergeOperations(CHECKOUT_OPERATIONS, CHECKOUT_ACT_OPERATIONS, WORKING_OPERATIONS),
      refusals: REFUSAL_WORDS,
    } as const;
  },
  feeds: [CHECKOUT_FEED],
} as const satisfies WireModule;
