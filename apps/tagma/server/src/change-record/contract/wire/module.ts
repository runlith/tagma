import { mergeOperations, type OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const changeRecord = {
  id: 'change-record',
  title: "The checkout's changes and authorship",
  operations: async () => {
    const [{ CHANGE_READS }, { CHANGE_WRITES }, { REFUSAL_WORDS }] = await Promise.all([
      import('./operations.js'),
      import('./writes.js'),
      import('./refusalWords.js'),
    ]);
    return { declarations: mergeOperations(CHANGE_READS, CHANGE_WRITES), refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
