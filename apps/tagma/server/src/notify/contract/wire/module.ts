import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const notify = {
  id: 'notify',
  title: 'Notifications to the operator',
  operations: async () => {
    const [{ NOTIFY_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./notification.js'), import('./refusalWords.js')]);
    return { declarations: NOTIFY_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
