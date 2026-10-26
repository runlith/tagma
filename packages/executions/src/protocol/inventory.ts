import { Schema } from 'effect';
import { CommandAdmission, CommandDeadline } from './command';
import { UsageReading } from './evidence';
import { ExecutionId, ExecutionPhase, ExecutionRef, ExecutionState } from './execution';
import { Pace } from './pace';
import { EndingReceipt, ProcessWatchReading } from './stop';
import { ExecutionSummary, HostMemory } from './runtime';

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

export const UnmeasuredCoverage = Schema.Struct({
  region: Schema.NonEmptyString,
  detail: Schema.String,
});
export type UnmeasuredCoverage = typeof UnmeasuredCoverage.Type;

export const CommandWatermark = Schema.Struct({
  admittedAtMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  execution: ExecutionId,
  filters: Schema.NonEmptyString,
});
export type CommandWatermark = typeof CommandWatermark.Type;

export const CommandQuery = Schema.Struct({
  scope: Schema.optional(Schema.NonEmptyString),
  owner: Schema.optional(Schema.NonEmptyString),
  cohort: Schema.optional(Schema.NonEmptyString),
  phases: Schema.optional(Schema.Array(ExecutionPhase).check(Schema.isMinLength(1))),
  after: Schema.optional(CommandWatermark),
  limit: Positive,
});
export type CommandQuery = typeof CommandQuery.Type;

export const CommandEntry = Schema.Struct({
  admission: CommandAdmission,
  state: ExecutionState,
  deadline: CommandDeadline,
  admittedAtMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ending: Schema.optional(EndingReceipt),
  usage: Schema.optional(UsageReading),
  processes: Schema.optional(ProcessWatchReading),
  pace: Schema.optional(Pace),
  printed: Schema.optional(Schema.Boolean),
});
export type CommandEntry = typeof CommandEntry.Type;

export const InventoryRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type InventoryRevision = typeof InventoryRevision.Type;

export const CommandPage = Schema.Struct({
  commands: Schema.Array(CommandEntry),
  after: Schema.optional(CommandWatermark),
  revision: InventoryRevision,
  memory: HostMemory,
  unmeasured: Schema.Array(UnmeasuredCoverage),
});
export type CommandPage = typeof CommandPage.Type;

export const InventoryDelta = Schema.Struct({
  _tag: Schema.Literal('Moved'),
  revision: InventoryRevision,
  usage: Schema.Array(UsageReading),
});
export type InventoryDelta = typeof InventoryDelta.Type;

export const InventoryGap = Schema.Struct({
  _tag: Schema.Literal('Gap'),
  revision: InventoryRevision,
  detail: Schema.String,
});
export type InventoryGap = typeof InventoryGap.Type;

export const InventoryFeedItem = Schema.Union([InventoryDelta, InventoryGap]).pipe(Schema.toTaggedUnion('_tag'));
export type InventoryFeedItem = typeof InventoryFeedItem.Type;

export const ChangesReset = Schema.Literals(['horizon', 'ahead', 'overflow']);
export type ChangesReset = typeof ChangesReset.Type;

export const InventoryChanges = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Changed'),
    revision: InventoryRevision,
    executions: Schema.Array(ExecutionSummary),
    left: Schema.Array(ExecutionRef),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Reset'),
    revision: InventoryRevision,
    reason: ChangesReset,
    detail: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type InventoryChanges = typeof InventoryChanges.Type;

export const InventoryRefusal = Schema.Literals(['filters-changed', 'unreadable']);
export type InventoryRefusal = typeof InventoryRefusal.Type;

export const CommandInventory = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Page'), page: CommandPage }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), reason: InventoryRefusal, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandInventory = typeof CommandInventory.Type;

export const CommandBatch = Schema.Struct({
  commands: Schema.Array(CommandEntry),
  revision: InventoryRevision,
  unmeasured: Schema.Array(UnmeasuredCoverage),
});
export type CommandBatch = typeof CommandBatch.Type;

export const CommandRefs = Schema.Array(ExecutionRef).check(Schema.isMinLength(1));
export type CommandRefs = typeof CommandRefs.Type;
