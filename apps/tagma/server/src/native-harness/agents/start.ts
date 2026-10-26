import type { Instruction } from '../../graph/contract/wire/instructions.js';
import { START_PARTS, type StartCost, type StartPartId } from '../../platform/contract/wire/start.js';

export type StartPieces = {
  readonly system: number;
  readonly tools: readonly { readonly chars: number; readonly deferred: boolean }[];
  readonly instructions: { readonly entries: readonly Instruction[] } | null;
  readonly notes: { readonly workspace: number | null; readonly graph: number | null; readonly deferred: number | null };
};

export function startCost(pieces: StartPieces): StartCost {
  const entries = pieces.instructions?.entries;
  const sized = (kinds: readonly string[]): number | null =>
    entries === undefined ? null : entries.reduce((sum, entry) => (kinds.includes(entry.kind) ? sum + entry.text.length : sum), 0);
  const known: Record<StartPartId, number | null> = {
    system: pieces.system,
    tools: pieces.tools.reduce((sum, tool) => (tool.deferred ? sum : sum + tool.chars), 0),
    law: sized(['law']),
    vocabulary: sized(['catalog', 'tag']),
    graph: pieces.notes.graph,
    workspace: pieces.notes.workspace,
    deferred: pieces.notes.deferred,
  };
  const parts = START_PARTS.map((id) => ({ id, chars: known[id] }));
  return { chars: parts.reduce((sum, part) => sum + (part.chars ?? 0), 0), parts };
}

export function inventoryChars(parts: readonly { readonly text: string; readonly deferredTools?: unknown }[]): number {
  return parts.reduce((sum, part) => (part.deferredTools === undefined ? sum : sum + part.text.length), 0);
}
