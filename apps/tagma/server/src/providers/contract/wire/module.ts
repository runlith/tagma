import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { ACCOUNTS_FEED } from './accounts.js';
import { CATALOG_FEED } from './catalog.js';

export const providers = {
  id: 'providers',
  title: 'Provider accounts',
  operations: async () => {
    const [{ PROVIDER_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: PROVIDER_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: [ACCOUNTS_FEED, CATALOG_FEED],
} as const satisfies WireModule;
