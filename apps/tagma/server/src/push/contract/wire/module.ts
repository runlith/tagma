import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const push = {
  id: 'push',
  title: 'Notifications on paired devices',
  operations: async () => {
    const [{ PUSH_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./push.js'), import('./refusalWords.js')]);
    return { declarations: PUSH_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
