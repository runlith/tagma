import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { TRANSLATION_FEED } from './feed.js';

export const translations = {
  id: 'translations',
  title: 'Block translations',
  operations: async () => {
    const [{ TRANSLATION_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: TRANSLATION_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: [TRANSLATION_FEED],
} as const satisfies WireModule;
