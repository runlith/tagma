import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { VIEW_FEEDS } from './feeds.js';

export const views = {
  id: 'views',
  title: 'App views',
  operations: async () => {
    const [{ VIEW_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: VIEW_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: VIEW_FEEDS,
} as const satisfies WireModule;
