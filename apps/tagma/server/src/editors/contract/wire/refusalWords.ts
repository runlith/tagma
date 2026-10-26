import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'editor-failed': 'Editor did not open the file',
  'editor-missing': 'Editor not installed',
} as const satisfies RefusalWords;
