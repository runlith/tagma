import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'connector-unknown': 'Unknown connector',
  'connector-unconnected': 'Connector not connected',
} as const satisfies RefusalWords;
