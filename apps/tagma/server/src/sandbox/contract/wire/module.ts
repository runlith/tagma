import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const sandbox = {
  id: 'sandbox',
  title: 'The sandboxes',
  operations: async () => {
    const [{ SANDBOX_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations/catalog.js'), import('./refusalWords.js')]);
    return { declarations: SANDBOX_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies WireModule;
