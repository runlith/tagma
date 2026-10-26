import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const artifacts = {
  id: 'artifacts',
  title: 'The pages this server hosts',
  operations: async () => {
    const [{ ARTIFACT_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: ARTIFACT_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
