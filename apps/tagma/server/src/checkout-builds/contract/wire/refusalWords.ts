import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'dev-surface-no-checkout': 'No checkout to serve the app from',
  'dev-surface-ended': 'The app dev server ended before it answered',
  'dev-surface-uncertain': 'The app dev server start is unproved',
} as const satisfies RefusalWords;
