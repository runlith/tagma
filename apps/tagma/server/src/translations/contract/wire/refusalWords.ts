import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'translation-model-missing': 'No model to translate with',
  'invalid-selection': 'Chosen model unavailable',
} as const satisfies RefusalWords;
