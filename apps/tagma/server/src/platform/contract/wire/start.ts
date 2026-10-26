import { Schema } from 'effect';

export const START_MOVES = ['law', 'graph'] as const;
export type StartMoves = (typeof START_MOVES)[number];

export const START_PARTS = ['system', 'tools', 'law', 'vocabulary', 'graph', 'workspace', 'deferred'] as const;
export type StartPartId = (typeof START_PARTS)[number];

export const startCostSchema = Schema.Struct({
  chars: Schema.Int,
  parts: Schema.Array(Schema.Struct({ id: Schema.Literals(START_PARTS), chars: Schema.NullOr(Schema.Int) })),
}).annotate({
  description:
    'What a new thread reads before its first word, in characters: the system prompt, the eager tool definitions, the law, the vocabulary, the graph note with its map, the workspace note and the deferred-tool list; a part this reading cannot compose is null.',
});
export type StartCost = typeof startCostSchema.Type;

export const startPriceSchema = Schema.Union([
  Schema.Struct({ agent: Schema.String, chars: Schema.Int, delta: Schema.Int }),
  Schema.Struct({ unmeasured: Schema.String }),
]).annotate({
  description:
    "This write's price on the start of every new thread of the project: the agent a new thread opens with, its start now in characters, and the characters this write added to it (negative when it removed some).",
});
export type StartPrice = typeof startPriceSchema.Type;

const isStartPrice = Schema.is(startPriceSchema);

export function startLines(answer: object): readonly string[] {
  const start: unknown = 'start' in answer ? answer.start : undefined;
  if (!isStartPrice(start)) return [];
  if ('unmeasured' in start) return [`start of a new thread: not measured — ${start.unmeasured}`];
  const change = start.delta === 0 ? 'unchanged' : `${start.delta > 0 ? '+' : '−'}${Math.abs(start.delta)} characters`;
  return [`start of a new ${start.agent} thread: ${change}, ${start.chars} characters now`];
}
