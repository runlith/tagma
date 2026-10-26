import type { RefusalWords } from '../../../platform/contract/wire/manifest.js';

export const REFUSAL_WORDS = {
  'bad-answer': 'Answer not among the options',
  'no-question': 'No question to answer',
  'sender-required': 'Needs a sending process',
  'too-many-open': 'Too many open notifications',
} as const satisfies RefusalWords;
