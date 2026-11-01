import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const editors = {
  id: 'editors',
  title: 'Editors of the machine',
  operations: async () => {
    const [{ EDITOR_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: EDITOR_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
