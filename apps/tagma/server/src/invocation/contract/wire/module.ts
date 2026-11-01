import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const invocation = {
  id: 'invocation',
  title: 'The operation registry',
  operations: async () => {
    const [{ INVOCATION_OPERATIONS }] = await Promise.all([import('./operations.js')]);
    return { declarations: INVOCATION_OPERATIONS };
  },
} as const satisfies WireModule;
