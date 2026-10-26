import type { ModelSwitches } from '@runlith/llm/models/description';

export type CursorSelection = {
  readonly id: string;
  readonly params: { id: string; value: string }[];
  readonly maxMode?: boolean;
};

export const contextModelId = (id: string, context: string): string => `${id}@context=${encodeURIComponent(context)}`;

export function cursorSelection(modelId: string, rung: string | null, switches: ModelSwitches = {}): CursorSelection {
  const split = modelId.lastIndexOf('@context=');
  const id = split < 0 ? modelId : modelId.slice(0, split);
  const params = Object.entries(switches).flatMap(([id, value]) => (id === 'maxMode' ? [] : [{ id, value }]));
  if (split >= 0) params.push({ id: 'context', value: decodeURIComponent(modelId.slice(split + 9)) });
  if (rung !== null) params.push({ id: 'reasoning', value: rung });
  return { id, params, maxMode: switches.maxMode === undefined ? undefined : switches.maxMode === 'true' };
}
