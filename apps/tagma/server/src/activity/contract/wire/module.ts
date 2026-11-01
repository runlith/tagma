import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { ACTIVITY_FEEDS } from './faults.js';

export const activity = {
  id: 'activity',
  title: 'What the product did',
  operations: async () => {
    const [{ ACTIVITY_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: ACTIVITY_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: ACTIVITY_FEEDS,
} as const satisfies WireModule;
