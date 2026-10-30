export const ASK_REFUSALS = [
  'ask-not-connected',
  'ask-quota',
  'ask-input-too-large',
  'ask-unreadable-answer',
  'ask-provider-failed',
  'ask-unanswerable',
] as const;
export type AskRefusal = (typeof ASK_REFUSALS)[number];
