import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'plugin-secret-unknown': 'Plugin declares no such secret',
  'secret-store-failed': 'Secret store failed',
  'secret-store-unavailable': 'No place to keep secrets',
  'secret-value-invalid': 'Secret value not valid',
} as const satisfies RefusalWords;
