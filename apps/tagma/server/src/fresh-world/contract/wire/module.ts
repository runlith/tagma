import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const freshWorld = {
  id: 'fresh-world',
  title: 'Fresh world of the release',
  operations: async () => {
    const [{ FRESH_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: FRESH_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
