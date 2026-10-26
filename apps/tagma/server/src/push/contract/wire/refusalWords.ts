import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'bad-subscription': 'Push subscription unusable',
  'device-required': 'Needs a paired device',
  'push-unavailable': 'Push unavailable on this server',
} as const satisfies RefusalWords;
