import { ASK_KINDS, type AskKind, type ModelCapability } from '@runlith/llm/models/description';
import { PROGRAM_REFUSALS } from '@runlith/tagma/adapter/provider';

export const ASK_REFUSALS = [...PROGRAM_REFUSALS, 'ask-unanswerable'] as const;
export type AskRefusal = (typeof ASK_REFUSALS)[number];

export type AskPath = 'request' | 'program';

export const askKinds = (path: AskPath, capabilities: readonly ModelCapability[]): readonly AskKind[] => {
  if (capabilities.includes('text')) return ASK_KINDS;
  return path === 'request' && capabilities.includes('decision') ? ['decision'] : [];
};
