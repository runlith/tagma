import { PROGRAM_REFUSALS } from '@runlith/tagma/adapter/provider';

export const ASK_REFUSALS = [...PROGRAM_REFUSALS, 'ask-unanswerable'] as const;
export type AskRefusal = (typeof ASK_REFUSALS)[number];

export type AskPath = 'request' | 'program';
