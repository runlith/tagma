import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const remote = {
  id: 'remote',
  title: 'Devices on another network',
  operations: async () => {
    const [{ REMOTE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: REMOTE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
