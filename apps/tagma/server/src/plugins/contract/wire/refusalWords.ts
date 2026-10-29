import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'plugin-clone-failed': 'Plugin not cloned',
  'plugin-id-taken': 'Plugin name taken',
  'plugin-names-collide': 'Plugin names collide',
  'plugin-not-installed': 'Plugin not installed',
  'plugin-pin-unreachable': 'Pinned commit not served',
  'plugin-preview-expired': 'Plugin preview expired',
  'plugin-refused': 'Plugin not readable',
  'plugin-source-unreadable': 'Plugin folder unreadable',
} as const satisfies RefusalWords;
