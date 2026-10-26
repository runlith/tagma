import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'destination-path': 'Destination outside the checkout',
  'expected-base': 'Destination changed meanwhile',
  'import-source': 'Not a sandbox of yours',
  'prepared-tree-busy': 'Prepared tree in use',
  'prepared-tree-unavailable': 'Prepared tree unavailable',
  'sandbox-busy': 'Sandbox in use',
  'sandbox-unavailable': 'Sandbox unavailable',
} as const satisfies RefusalWords;
