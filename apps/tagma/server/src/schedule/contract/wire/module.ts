import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const schedule = {
  id: 'schedule',
  title: 'Periodic runs',
  operations: async () => {
    const { SCHEDULE_OPERATIONS } = await import('./schedule.js');
    return { declarations: SCHEDULE_OPERATIONS };
  },
} as const satisfies OperationManifest;
