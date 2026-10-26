import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'config-invalid': 'Rules config does not build',
  'config-unrunnable': 'Rules config cannot run',
  'config-unstored': 'Evaluated config cannot be kept',
} as const satisfies RefusalWords;
