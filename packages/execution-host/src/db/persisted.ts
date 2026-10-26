import { Schema } from 'effect';
import { CallBudget, CallRetention, CancellationCause, SourceCompletion } from '@runlith/executions/protocol/call';
import { ExecutionRef, HostRequestRef } from '@runlith/executions/protocol/execution';
import { StopAction } from '@runlith/executions/protocol/stop';
import { HostCustody } from '@runlith/executions/protocol/registration';
import { NativeRelation } from '@runlith/executions/protocol/capacity';
import { Refusal, UncertainEffect } from '@runlith/executions/protocol/host';
import { LimitProvenance } from '@runlith/executions/protocol/command';
import { Pace } from '@runlith/executions/protocol/pace';

export const OperationKind = Schema.Literals(['receipt', 'tombstone', 'custody']);
export type OperationKind = typeof OperationKind.Type;

export const OperationReceipt = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Accepted'),
    execution: Schema.optional(ExecutionRef),
  }),
  Schema.Struct({ _tag: Schema.Literal('CustodyAccepted'), custody: HostCustody }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type OperationReceipt = typeof OperationReceipt.Type;

export const StopIntent = Schema.Struct({
  operation: HostRequestRef,
  execution: ExecutionRef,
  cause: CancellationCause,
  coverage: Schema.Array(NativeRelation),
  requested: Schema.optional(StopAction),
  joined: Schema.optional(Schema.Boolean),
});
export type StopIntent = typeof StopIntent.Type;

export const AcceptedRevisionRequest = Schema.Struct({
  execution: ExecutionRef,
  operation: HostRequestRef,
  fingerprint: Schema.NonEmptyString,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  executionMs: Schema.Int.check(Schema.isGreaterThan(0)),
  ceilingMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  actor: Schema.NonEmptyString,
  cause: Schema.NonEmptyString,
  exception: Schema.optional(Schema.Struct({ actor: Schema.NonEmptyString, cause: Schema.NonEmptyString })),
});
export type AcceptedRevisionRequest = typeof AcceptedRevisionRequest.Type;

export const RevisionStatus = Schema.Literals(['pending', 'applied', 'ended']);
export type RevisionStatus = typeof RevisionStatus.Type;

export const CommandRevisionRecord = Schema.Struct({ ...AcceptedRevisionRequest.fields, outcome: RevisionStatus });
export type CommandRevisionRecord = typeof CommandRevisionRecord.Type;

export const CallTiming = Schema.Struct({
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  acquiredAt: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.NonEmptyString),
  wallExpiresAt: Schema.optional(Schema.Number),
  ceilingMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  origin: LimitProvenance,
  foregroundMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type CallTiming = typeof CallTiming.Type;

export const PaceRecord = Schema.Struct({
  execution: ExecutionRef,
  initial: Pace,
  target: Pace,
  lowered: Schema.Boolean,
});
export type PaceRecord = typeof PaceRecord.Type;

export const BoundRuleRecord = Schema.Struct({
  pid: Schema.Int,
  birth: Schema.String,
  ruleId: Schema.NonEmptyString,
  dueMs: Schema.Number,
});
export type BoundRuleRecord = typeof BoundRuleRecord.Type;

export const RulesRecord = Schema.Struct({
  execution: ExecutionRef,
  bound: Schema.Array(BoundRuleRecord),
});
export type RulesRecord = typeof RulesRecord.Type;

export const CallRecord = Schema.Struct({
  operation: HostRequestRef,
  execution: Schema.optional(ExecutionRef),
  budget: CallBudget,
  started: Schema.optional(Schema.Literal('native-acquired')),
  timing: Schema.optional(CallTiming),
  sources: Schema.optional(SourceCompletion),
  retention: Schema.optional(CallRetention),
});
export type CallRecord = typeof CallRecord.Type;

export const StoredEcho = Schema.Struct({
  after: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  bytes: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))),
});
export type StoredEcho = typeof StoredEcho.Type;
