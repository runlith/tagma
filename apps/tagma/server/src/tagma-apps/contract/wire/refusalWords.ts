import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'app-collision': 'App found in two places',
  'app-floor-unreadable': 'App folders unreadable',
  'app-not-installed': 'App not installed',
  'app-refused': 'App manifest not accepted',
  'app-source-taken': 'App installed from another folder',
  'app-unknown': 'App not found',
} as const satisfies RefusalWords;
