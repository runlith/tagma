import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const images = {
  id: 'images',
  title: 'Pictures drawn by image models',
  operations: async () => {
    const [{ IMAGE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: IMAGE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
