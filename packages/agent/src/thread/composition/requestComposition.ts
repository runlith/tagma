import type { Message } from '@runlith/llm/schema/messages';
import { discoveredToolNames } from '../../agent/AgentDeferredTools';
import { agentOriginOf, type AgentMessageOrigin } from '../../agent/AgentSignal';
import { THREAD_COMPOSITION_PARTS, type ThreadCompositionPartId } from '../../protocol/compositionParts';

export type ThreadCompositionPart = {
  readonly id: ThreadCompositionPartId;
  readonly count: number;
  readonly tokens: number;
};

export type ThreadClearedOutput = {
  readonly count: number;
  readonly tokens: number;
};

export type ThreadCompositionLedger = {
  readonly runs: number;
  readonly compactions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: readonly { readonly name: string; readonly count: number }[];
};

export type ThreadPruningStanding = {
  readonly share: number;
  readonly protectedTokens: number;
  readonly liveToolOutputTokens: number;
  readonly nextPruneAtTokens: number;
};

export type ThreadRequestComposition = {
  readonly threadId: string;
  readonly reading: 'measured' | 'estimated';
  readonly total: number;
  readonly parts: readonly ThreadCompositionPart[];
  readonly tools: readonly { readonly name: string; readonly tokens: number }[];
  readonly deferredTools: readonly string[];
  readonly orientation: readonly { readonly name: string; readonly tokens: number }[];
  readonly cleared: ThreadClearedOutput;
  readonly ledger: ThreadCompositionLedger;
  readonly pruning: ThreadPruningStanding;
};

export type ThreadCompositionInput = {
  readonly threadId: string;
  readonly history: readonly Message[];
  readonly fixed: {
    readonly systemChars: number;
    readonly tools: readonly { readonly name: string; readonly chars: number; readonly hidden?: true }[];
  } | null;
  readonly clearedMarker: string;
  readonly cleared: ThreadClearedOutput;
  readonly share: number;
  readonly protectTokens: number;
  readonly nextPruneAtTokens: number;
  readonly ledger: Omit<ThreadCompositionLedger, 'toolCalls'>;
  readonly billedInput: number | null;
  readonly estimatedTotal: number;
};

export function threadRequestComposition(input: ThreadCompositionInput): ThreadRequestComposition {
  const chars = new Map<ThreadCompositionPartId, number>();
  const counts = new Map<ThreadCompositionPartId, number>();
  const toolCalls = new Map<string, number>();
  const orientationChars = new Map<string, number>();

  const add = (id: ThreadCompositionPartId, size: number, things = 1): void => {
    chars.set(id, (chars.get(id) ?? 0) + size);
    counts.set(id, (counts.get(id) ?? 0) + things);
  };

  const schemas = declaredToolSchemas(input.history, input.fixed?.tools ?? []);
  if (input.fixed) {
    add('system', input.fixed.systemChars);
    for (const tool of schemas.declared) add('tools', tool.chars);
  }

  for (const message of input.history) {
    const origin = agentOriginOf(message);
    if (origin === 'orientation' || origin === 'guidance' || origin === 'envelope') {
      add(originPart(origin), sizeOf(message));
      if (origin === 'orientation') declaredSections(message, orientationChars);
      continue;
    }
    if (origin === 'summary') {
      add('summary', sizeOf(message));
      continue;
    }
    for (const part of message.content) {
      switch (part.type) {
        case 'tool-call':
          add('toolCall', sizeOf(part));
          toolCalls.set(part.name, (toolCalls.get(part.name) ?? 0) + 1);
          break;
        case 'tool-result':
          add('toolOutput', sizeOf(part), isCleared(part.result, input.clearedMarker) ? 0 : 1);
          break;
        case 'reasoning':
          add('reasoning', sizeOf(part));
          break;
        default:
          add(message.role === 'user' ? 'user' : 'assistant', sizeOf(part));
          break;
      }
    }
  }

  const measuredChars = [...chars.values()].reduce((sum, size) => sum + size, 0);
  const total = input.billedInput ?? input.estimatedTotal;
  const price = (size: number): number => (measuredChars === 0 ? 0 : Math.round((size / measuredChars) * total));

  const parts = THREAD_COMPOSITION_PARTS.map((id) => ({
    id,
    count: counts.get(id) ?? 0,
    tokens: price(chars.get(id) ?? 0),
  }));

  return {
    threadId: input.threadId,
    reading: input.billedInput === null ? 'estimated' : 'measured',
    total,
    parts,
    tools: [...schemas.declared]
      .map((tool) => ({ name: tool.name, tokens: price(tool.chars) }))
      .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name)),
    deferredTools: schemas.hidden,
    orientation: [...orientationChars]
      .map(([name, size]) => ({ name, tokens: price(size) }))
      .sort((left, right) => right.tokens - left.tokens || left.name.localeCompare(right.name)),
    cleared: input.cleared,
    ledger: {
      ...input.ledger,
      toolCalls: [...toolCalls]
        .map(([name, calls]) => ({ name, count: calls }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    },
    pruning: {
      share: input.share,
      protectedTokens: input.protectTokens,
      liveToolOutputTokens: parts.find((part) => part.id === 'toolOutput')?.tokens ?? 0,
      nextPruneAtTokens: input.nextPruneAtTokens,
    },
  };
}

export function declaredToolSchemas<T extends { readonly name: string; readonly hidden?: true }>(
  history: readonly Message[],
  tools: readonly T[],
): { readonly declared: readonly T[]; readonly hidden: readonly string[] } {
  const revealed = discoveredToolNames(history);
  return {
    declared: tools.filter((tool) => tool.hidden !== true || revealed.has(tool.name)),
    hidden: tools
      .filter((tool) => tool.hidden === true && !revealed.has(tool.name))
      .map((tool) => tool.name)
      .sort(),
  };
}

function originPart(origin: Exclude<AgentMessageOrigin, 'summary'>): ThreadCompositionPartId {
  switch (origin) {
    case 'orientation':
      return 'orientation';
    case 'guidance':
      return 'guidance';
    case 'envelope':
      return 'envelope';
  }
}

function isCleared(result: unknown, marker: string): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const value = result as { type?: unknown; value?: unknown };
  return value.type === 'text' && value.value === marker;
}

function sizeOf(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function declaredSections(message: Message, into: Map<string, number>): void {
  const declared = message.metadata?.parts;
  if (!Array.isArray(declared)) return;
  for (const section of declared) {
    if (typeof section !== 'object' || section === null) continue;
    const { name, chars } = section as { name?: unknown; chars?: unknown };
    if (typeof name !== 'string' || typeof chars !== 'number' || !Number.isFinite(chars)) continue;
    into.set(name, (into.get(name) ?? 0) + chars);
  }
}
