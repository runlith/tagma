import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'capture-refused': 'Audio could not be captured',
  'models-unreadable': 'Speech models unreadable',
  'no-model': 'No model can do this',
  'player-refused': 'Sound could not be played',
  'speech-failed': 'Speech failed',
  'stop-refused': 'Capture could not be stopped',
  'track-invalid': 'Tracks not valid',
  'unknown-capture': 'Capture not found',
  'unknown-model': 'Unknown model',
  'unknown-recognition': 'Recognition not found',
} as const satisfies RefusalWords;
