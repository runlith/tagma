import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { PAGE_FEED, THREAD_PAGES_FEED } from './feed.js';

export const artifacts = {
  id: 'artifacts',
  title: 'The pages this server hosts',
  operations: async () => {
    const [{ ARTIFACT_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: ARTIFACT_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: [THREAD_PAGES_FEED, PAGE_FEED],
} as const satisfies WireModule;
