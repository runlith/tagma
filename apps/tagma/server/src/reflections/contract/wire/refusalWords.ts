import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'reflection-shape': 'Reflection is incomplete',
} as const satisfies RefusalWords;
