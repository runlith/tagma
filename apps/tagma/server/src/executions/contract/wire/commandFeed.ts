import { Schema } from 'effect';
import { UsageReading } from '@runlith/executions/protocol/evidence';
import { CommandCurrent, CommandCursor, CommandHostAnswer, CommandReading } from './commands.js';
import { OperationKeyRetention } from './requestKeys.js';
import { TerminalRow } from './terminals.js';

export const CommandFeedSubscription = Schema.Struct({
  projectId: Schema.Int.check(Schema.isGreaterThan(0)),
  ended: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type CommandFeedSubscription = typeof CommandFeedSubscription.Type;

export const CommandFeedSnapshot = Schema.Struct({
  projectId: Schema.Int,
  composedAt: Schema.Number,
  active: Schema.Array(CommandReading),
  ended: Schema.Array(CommandReading),
  endedAfter: Schema.optional(CommandCursor),
  terminals: Schema.Array(TerminalRow),
  host: CommandHostAnswer,
  stale: Schema.Boolean,
  operationKeys: OperationKeyRetention,
});

export type CommandFeedSnapshot = typeof CommandFeedSnapshot.Type;

export const CommandMeasured = Schema.Struct({
  key: Schema.NonEmptyString,
  usage: UsageReading,
  current: Schema.optional(CommandCurrent),
});

export type CommandMeasured = typeof CommandMeasured.Type;

export const CommandFeedRows = Schema.Struct({
  order: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  readings: Schema.Array(CommandReading),
  measured: Schema.Array(CommandMeasured),
});

export type CommandFeedRows = typeof CommandFeedRows.Type;

export const CommandFeedDelta = Schema.Struct({
  composedAt: Schema.Number,
  active: Schema.optionalKey(CommandFeedRows),
  ended: Schema.optionalKey(CommandFeedRows),
  endedAfter: Schema.optionalKey(Schema.NullOr(CommandCursor)),
  terminals: Schema.optionalKey(Schema.Array(TerminalRow)),
  host: Schema.optionalKey(CommandHostAnswer),
  stale: Schema.optionalKey(Schema.Boolean),
  operationKeys: Schema.optionalKey(OperationKeyRetention),
});

export type CommandFeedDelta = typeof CommandFeedDelta.Type;

export const CommandFeedFrame = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Snapshot'),
    sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    snapshot: CommandFeedSnapshot,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Delta'),
    sequence: Schema.Int.check(Schema.isGreaterThan(0)),
    base: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    delta: CommandFeedDelta,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));

export type CommandFeedFrame = typeof CommandFeedFrame.Type;
