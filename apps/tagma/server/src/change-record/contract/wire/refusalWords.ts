import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'context-too-wide': 'Too much context asked',
  'file-write-failed': 'File write failed',
  'lines-held': 'Lines held by another session',
  'multiple-checkouts': 'Lines in several checkouts',
  'no-record': 'No session record',
  'path-oversized': 'File too large to read',
  'path-unread': 'File could not be read',
  'repository-unread': 'Repository could not be read',
  'root-unproven': 'Checkout could not be identified',
  'selection-shape': 'Invalid selection',
  'side-with-commit': 'Side cannot combine with a commit',
  'stretch-gone': 'Hidden run is gone',
  'unknown-address': 'No such agent',
  'walk-cut': 'Line reading cut short',
} as const satisfies RefusalWords;
