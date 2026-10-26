import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'cross-device': 'Different volumes',
  'edits-invalid': 'Edits do not apply',
  'in-checkout': 'File belongs to a checkout',
  'index-lost': 'File index was dropped',
  'not-a-directory': 'Not a directory',
  'not-a-file': 'Not a file',
  'not-text': 'Not UTF-8 text',
  'path-relative': 'Path must be absolute',
  'same-path': 'Cannot move onto itself',
  'source-moved': 'Source changed or gone',
  'target-exists': 'Target is taken',
  'too-large': 'File too large',
  'worker-unavailable': 'File worker unavailable',
} as const satisfies RefusalWords;
