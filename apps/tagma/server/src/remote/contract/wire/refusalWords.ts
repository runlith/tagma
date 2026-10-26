import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'remote-not-ready': 'Remote access not ready',
  'unknown-device': 'Device not paired',
} as const satisfies RefusalWords;
