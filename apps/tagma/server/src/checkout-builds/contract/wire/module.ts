import type { OperationManifest } from '../../../platform/contract/wire/manifest.js';

export const checkoutBuilds = {
  id: 'checkout-builds',
  title: 'Builds from the checkout',
  operations: async () => {
    const [{ DEV_SURFACE_OPERATIONS }, { REFUSAL_WORDS }] = await Promise.all([import('./operations.js'), import('./refusalWords.js')]);
    return { declarations: DEV_SURFACE_OPERATIONS, refusals: REFUSAL_WORDS };
  },
} as const satisfies OperationManifest;
