import type { ModelRef } from '@opencode/client';

export function modelSelection(model: string, reasoning: string | null): ModelRef {
  const split = model.indexOf('/');
  if (split <= 0 || split === model.length - 1) throw new Error(`Invalid OpenCode model: ${model}`);
  return { providerID: model.slice(0, split), id: model.slice(split + 1), variant: reasoning ?? undefined };
}
