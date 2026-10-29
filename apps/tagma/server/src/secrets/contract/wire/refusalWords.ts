import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'secret-owner-unknown': 'No such secret owner',
  'secret-owner-failed': 'Secret owner failed',
  'secret-unknown': 'No such secret',
  'secret-store-failed': 'Secret store failed',
  'secret-store-unavailable': 'No place to keep secrets',
  'secret-value-invalid': 'Secret value not valid',
} as const satisfies RefusalWords;
