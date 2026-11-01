import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { MARKETPLACE_FEEDS } from './rows.js';

export const marketplaces = {
  id: 'marketplaces',
  title: 'Marketplaces',
  operations: async () => {
    const [{ MARKETPLACE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: MARKETPLACE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: MARKETPLACE_FEEDS,
} as const satisfies WireModule;
