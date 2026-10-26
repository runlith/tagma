import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'target-shape': 'Symbol not named',
  'symbol-ambiguous': 'Several symbols fit',
  'occurrences-unread': 'Occurrences not searched',
  'navigation-disabled': 'Code navigation is switched off',
  'engine-lost': 'Navigation engine ended',
  'engine-failed': 'Navigation engine keeps failing',
  'answer-expired': 'Answer no longer kept',
} as const satisfies RefusalWords;
