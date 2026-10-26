import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'plugin-collision': 'Plugin found in two places',
  'plugin-floor-unreadable': 'Plugin folders unreadable',
  'plugin-not-installed': 'Plugin not installed',
  'plugin-refused': 'Plugin manifest not accepted',
  'plugin-source-taken': 'Plugin installed from another folder',
  'plugin-unknown': 'Plugin not found',
} as const satisfies RefusalWords;
