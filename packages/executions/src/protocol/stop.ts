import { Schema } from 'effect';
import { CallRetention, CancellationCause, SourceCompletion, STOP_STEPS, StopStep } from './call';
import { NativeRelation } from './capacity';
import { Cleanup, ExecutionRef, NativeExit, HostRequestRef, ProcessCost, StreamEnding as StreamEndingKind } from './execution';
import { Refusal, UncertainEffect } from './host';
import { Stream } from './record';
import { EvidenceScope, ProcessWitness } from './evidence';

export const StopAction = Schema.Literals(['signal', 'destroy']);
export type StopAction = typeof StopAction.Type;

export const EndedAt = Schema.Literals(['unsignalled', ...STOP_STEPS]);
export type EndedAt = typeof EndedAt.Type;

export const ConfirmedEnding = Schema.Struct({
  pid: Schema.Int,
  relation: NativeRelation,
  exit: NativeExit,
  step: Schema.optional(EndedAt),
});
export type ConfirmedEnding = typeof ConfirmedEnding.Type;

export const ResidualKind = Schema.Literals(['process', 'pty', 'record', 'callback']);
export type ResidualKind = typeof ResidualKind.Type;

export const ResidualResource = Schema.Struct({
  kind: ResidualKind,
  detail: Schema.String,
  pid: Schema.optional(Schema.Int),
  relation: Schema.optional(NativeRelation),
});
export type ResidualResource = typeof ResidualResource.Type;

export const UnverifiableResource = Schema.Struct({
  kind: ResidualKind,
  detail: Schema.String,
  reason: Schema.String,
});
export type UnverifiableResource = typeof UnverifiableResource.Type;

export const RuleNamed = Schema.Struct({
  id: Schema.NonEmptyString,
  words: Schema.NonEmptyArray(Schema.NonEmptyString),
  folder: Schema.optional(Schema.NonEmptyString),
  limitMs: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type RuleNamed = typeof RuleNamed.Type;

export const ProcessRuling = Schema.Union([
  Schema.Struct({ _tag: Schema.tag('Ending'), pid: Schema.Int, process: Schema.String, rule: RuleNamed }),
  Schema.Struct({ _tag: Schema.tag('Ended'), pid: Schema.Int, process: Schema.String, rule: RuleNamed, step: EndedAt }),
  Schema.Struct({
    _tag: Schema.tag('Survived'),
    pid: Schema.Int,
    process: Schema.String,
    rule: RuleNamed,
    steps: Schema.Array(StopStep),
  }),
  Schema.Struct({
    _tag: Schema.tag('Unverifiable'),
    pid: Schema.Int,
    process: Schema.String,
    rule: RuleNamed,
    reason: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.tag('Unread'),
    pid: Schema.Int,
    process: Schema.String,
    fields: Schema.Array(Schema.Literals(['args', 'folder'])),
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ProcessRuling = typeof ProcessRuling.Type;

export const Unwatched = Schema.Literals(['no-reader', 'leader-unproven', 'ended']);
export type Unwatched = typeof Unwatched.Type;

export const ProcessWatchReading = Schema.Struct({
  members: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  capped: Schema.Boolean,
  watched: Schema.Boolean,
  unwatched: Schema.optional(Unwatched),
  failures: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rulings: Schema.Array(ProcessRuling),
  omitted: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ProcessWatchReading = typeof ProcessWatchReading.Type;

export const StopCoverage = Schema.Literals(['leader', 'covered', 'partial', 'unknown']);
export type StopCoverage = typeof StopCoverage.Type;

export const ResidualInput = Schema.Struct({ origin: ExecutionRef, pid: Schema.Int.check(Schema.isGreaterThan(0)) });
export type ResidualInput = typeof ResidualInput.Type;

export const ResidualEnding = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Ended'), ...ResidualInput.fields, steps: Schema.Array(StopStep) }),
  Schema.Struct({ _tag: Schema.Literal('Survived'), ...ResidualInput.fields, steps: Schema.Array(StopStep) }),
  Schema.Struct({
    _tag: Schema.Literal('Refused'),
    ...ResidualInput.fields,
    reason: Schema.Literals(['execution-unknown', 'not-residual', 'identity-unproven', 'identity-changed', 'unreadable']),
    detail: Schema.String,
    steps: Schema.Array(StopStep),
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ResidualEnding = typeof ResidualEnding.Type;

export const ProcessTarget = Schema.Struct({
  scope: EvidenceScope,
  identity: ProcessWitness,
});
export type ProcessTarget = typeof ProcessTarget.Type;

export const ProcessEnding = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Ended'), target: ProcessTarget, steps: Schema.Array(StopStep) }),
  Schema.Struct({ _tag: Schema.Literal('Survived'), target: ProcessTarget, steps: Schema.Array(StopStep) }),
  Schema.Struct({
    _tag: Schema.Literal('Refused'),
    target: ProcessTarget,
    steps: Schema.Array(StopStep),
    reason: Schema.Literals([
      'scope-mismatch',
      'not-measured',
      'managed-process',
      'identity-unproven',
      'identity-changed',
      'unreadable',
      'signal-failed',
    ]),
    detail: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ProcessEnding = typeof ProcessEnding.Type;

export const StreamEnding = Schema.Struct({ stream: Stream, ending: StreamEndingKind });
export type StreamEnding = typeof StreamEnding.Type;

export const EndingReceipt = Schema.Struct({
  execution: ExecutionRef,
  nativeExit: Schema.optional(NativeExit),
  cost: ProcessCost,
  coverage: Schema.Array(NativeRelation),
  relation: StopCoverage,
  confirmed: Schema.Array(ConfirmedEnding),
  residual: Schema.Array(ResidualResource),
  unverifiable: Schema.Array(UnverifiableResource),
  streams: Schema.Array(StreamEnding),
  cleanup: Cleanup,
  retention: CallRetention,
  abandonedOutput: Schema.Boolean,
  unacquired: Schema.optional(Schema.String),
});
export type EndingReceipt = typeof EndingReceipt.Type;

export const FinalFacts = Schema.Struct({
  execution: ExecutionRef,
  nativeExit: Schema.optional(NativeExit),
  sources: SourceCompletion,
  cleanup: Cleanup,
  retention: CallRetention,
  confirmed: Schema.Array(ConfirmedEnding),
  residual: Schema.Array(ResidualResource),
  unverifiable: Schema.Array(UnverifiableResource),
  streams: Schema.Array(StreamEnding),
  relation: StopCoverage,
  coverage: Schema.Array(NativeRelation),
  abandonedOutput: Schema.Boolean,
  unacquired: Schema.optional(Schema.String),
});
export type FinalFacts = typeof FinalFacts.Type;

export const recordedEnding = (facts: FinalFacts): EndingReceipt => ({
  execution: facts.execution,
  nativeExit: facts.nativeExit,
  coverage: facts.coverage,
  relation: facts.relation,
  confirmed: facts.confirmed,
  residual: facts.residual,
  unverifiable: facts.unverifiable,
  streams: facts.streams,
  cleanup: facts.cleanup,
  retention: facts.retention,
  abandonedOutput: facts.abandonedOutput,
  unacquired: facts.unacquired,
  cost: { _tag: 'Unmeasured', reason: 'unknown', detail: 'the final-facts row holds no accounting for this ending' },
});

export const EndingMeasurement = Schema.Literals(['recorded', 'remeasured']);
export type EndingMeasurement = typeof EndingMeasurement.Type;

export type EndingReading = EndingReceipt & { readonly measurement?: EndingMeasurement };

export const StopReceipt = Schema.Struct({
  ...EndingReceipt.fields,
  operation: HostRequestRef,
  requested: StopAction,
  cause: CancellationCause,
  steps: Schema.Array(StopStep),
});
export type StopReceipt = typeof StopReceipt.Type;

export const SignalAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Delivered'), execution: ExecutionRef, signal: Schema.NonEmptyString, pid: Schema.Int }),
  Schema.Struct({
    _tag: Schema.Literal('SignalUnavailable'),
    execution: ExecutionRef,
    signal: Schema.NonEmptyString,
    reason: Schema.Literals(['exited', 'closed', 'unsupported', 'stopping', 'os']),
    detail: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type SignalAnswer = typeof SignalAnswer.Type;

export const ShutdownAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('ShutdownComplete'),
    operation: HostRequestRef,
    executions: Schema.Array(StopReceipt),
  }),
  Schema.Struct({
    _tag: Schema.Literal('ShutdownIncomplete'),
    operation: HostRequestRef,
    executions: Schema.Array(StopReceipt),
    residual: Schema.Array(ResidualResource),
    unverifiable: Schema.Array(UnverifiableResource),
    reason: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('Refused'), operation: HostRequestRef, refusal: Refusal }),
  Schema.Struct({ _tag: Schema.Literal('Uncertain'), effect: UncertainEffect }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ShutdownAnswer = typeof ShutdownAnswer.Type;
