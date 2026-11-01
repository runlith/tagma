import type { WireModule } from '../../../platform/contract/wire/manifest.js';
import { NEXT_FEED } from './next.js';

export const installation = {
  id: 'installation',
  title: 'This installation',
  operations: async () => {
    const [{ INSTALLATION_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: INSTALLATION_OPERATIONS, refusals: REFUSAL_WORDS };
  },
  feeds: [NEXT_FEED],
} as const satisfies WireModule;
