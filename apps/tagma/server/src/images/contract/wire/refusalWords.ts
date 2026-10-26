import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'image-input': 'Picture input not usable',
  'image-limit': 'Picture limit reached',
  'image-refused': 'Image model gave no picture',
  'no-image-model': 'No image model available',
} as const satisfies RefusalWords;
