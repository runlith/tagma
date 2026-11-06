import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'fresh-no-feed': 'This build knows no release feed',
  'fresh-no-release': 'The feed offers no such release',
  'fresh-unavailable': 'The release could not be taken',
  'fresh-host': 'The Mac refused a step of the fresh world',
} as const satisfies RefusalWords;
