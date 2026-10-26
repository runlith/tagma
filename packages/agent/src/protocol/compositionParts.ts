export const THREAD_COMPOSITION_PARTS = [
  'system',
  'tools',
  'orientation',
  'user',
  'assistant',
  'reasoning',
  'toolCall',
  'toolOutput',
  'guidance',
  'envelope',
  'summary',
] as const;

export type ThreadCompositionPartId = (typeof THREAD_COMPOSITION_PARTS)[number];
