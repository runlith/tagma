import type { WireModule } from '../../../platform/contract/wire/manifest.js';

export const performance = {
  id: 'performance',
  title: 'The running process',
  operations: async () => {
    const [{ PERFORMANCE_OPERATIONS }] = await Promise.all([import('./operations.js')]);
    return { declarations: PERFORMANCE_OPERATIONS };
  },
} as const satisfies WireModule;
