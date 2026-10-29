import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'marketplace-entry-refused': 'Entry not installable',
  'marketplace-entry-unknown': 'No such entry',
  'marketplace-gone': 'Marketplace removed',
  'marketplace-taken': 'Marketplace name taken',
  'marketplace-unfetched': 'Marketplace not fetched yet',
  'marketplace-unknown': 'Unknown marketplace',
  'marketplace-unreachable': 'Marketplace not fetched',
  'marketplace-unreadable': 'Marketplace list unreadable',
  'plugin-without-marketplace': 'Plugin not from a marketplace',
} as const satisfies RefusalWords;
