import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'again-running': 'Already being recognized again',
  'capture-refused': 'Audio could not be captured',
  'listening-ended': 'Listening is no longer recording',
  'listening-live': 'Listening is still recording',
  'models-unreadable': 'Speech models unreadable',
  'no-audio': 'No sound kept to hear again',
  'no-model': 'No model can do this',
  'player-refused': 'Sound could not be played',
  'query-too-short': 'Search words too short',
  'speech-failed': 'Speech failed',
  'threads-unavailable': 'Threads could not be read',
  'track-invalid': 'Tracks not valid',
  'unknown-listening': 'Listening not found',
  'unknown-mark': 'Mark not found',
  'unknown-model': 'Unknown model',
  'unknown-recognition': 'Recognition not found',
  'unknown-speaker': 'Speaker not found',
  'unknown-thread': 'No thread named',
  'unknown-track': 'Track not found',
} as const satisfies RefusalWords;
