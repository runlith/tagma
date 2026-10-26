import { Schema } from 'effect';
import { ThreadRewindMark } from '@runlith/agent/transcript/eventFold';
import { startCostSchema } from '../../../platform/contract/wire/start.js';

export const START_ENTRY = 'start-cost';

export const StartEntry = Schema.Struct({
  type: Schema.Literal(START_ENTRY),
  id: Schema.NonEmptyString,
  runId: Schema.String,
  occurredAt: Schema.String,
  ...startCostSchema.fields,
  tokens: Schema.Int,
  window: Schema.Int,
  share: Schema.Number,
  inputTokens: Schema.NullOr(Schema.Int),
  rewound: Schema.optional(ThreadRewindMark),
});
export type StartEntry = typeof StartEntry.Type;

export const startEntryId = (threadId: string): string => `start-cost:${threadId}`;

export const isStartEntry = Schema.is(StartEntry);
