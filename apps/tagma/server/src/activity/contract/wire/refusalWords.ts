import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'activity-unreadable': 'Activity cannot be read',
} as const satisfies RefusalWords;
