import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { TREE_FEED } from './directory.js';
import { DOCUMENT_FEED, LOOSE_DOCUMENT_FEED } from './document.js';
import { SCRATCH_FEED } from './scratch.js';
import { SEARCH_FEED } from './search.js';

export const checkoutFiles = {
  id: 'checkout-files',
  title: "The operator's files of a checkout",
  operations: async () => {
    const [{ FILE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: FILE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: [TREE_FEED, SEARCH_FEED, DOCUMENT_FEED, LOOSE_DOCUMENT_FEED, SCRATCH_FEED],
} as const satisfies WireModule;
