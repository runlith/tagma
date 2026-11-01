import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const config = {
  id: 'config',
  title: 'The tagma.config.ts a judged version declares: its inspections and format commands',
  operations: async () => {
    const [{ CONFIG_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: CONFIG_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
