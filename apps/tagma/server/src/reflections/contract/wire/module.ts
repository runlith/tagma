import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const reflections = {
  id: 'reflections',
  title: 'Friction with Tagma',
  journaled: true,
  operations: async () => {
    const [{ REFLECTION_FILING_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operations.js'),
      import('./refusalWords.js'),
    ]);
    return { declarations: REFLECTION_FILING_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
