import { type Effect, Schema } from 'effect';
import { Cleanup, ExecutionRef, NativeExit, HostRequestRef, ProcessCost } from './execution';
import { ByteOffset } from './record';

export const STOP_STEPS = ['hang-up', 'interrupt', 'terminate', 'kill'] as const;
export const StopStep = Schema.Literals(STOP_STEPS);
export type StopStep = typeof StopStep.Type;

export const STOP_LADDER = {
  terminateAtMs: 1_500,
  killAtMs: 2_000,
  reapMs: 2_500,
} as const;

export const STOP_LADDER_MS = STOP_LADDER.killAtMs + STOP_LADDER.reapMs;

export const CallBudget = Schema.Struct({
  timeoutMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type CallBudget = typeof CallBudget.Type;

export const CallDeadline = Schema.Struct({
  execution: ExecutionRef,
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
  start: Schema.Literal('native-acquired'),
});
export type CallDeadline = typeof CallDeadline.Type;

export const CancellationCause = Schema.Literals([
  'timeout',
  'run-abort',
  'scope-closed',
  'caller-lost',
  'explicit-stop',
  'shutdown',
  'not-started',
]);
export type CancellationCause = typeof CancellationCause.Type;

const HOST_ONLY_CAUSES = ['not-started'] as const;
export type DeclaredCancellationCause = Exclude<CancellationCause, (typeof HOST_ONLY_CAUSES)[number]>;
export const DeclaredCancellationCause = Schema.Literals(
  CancellationCause.literals.filter(
    (cause): cause is DeclaredCancellationCause => !(HOST_ONLY_CAUSES as readonly string[]).includes(cause),
  ),
);

export class CallCancellation extends Error {
  constructor(
    readonly reason: DeclaredCancellationCause,
    message: string,
  ) {
    super(message);
    this.name = 'CallCancellation';
  }
}

export type CallStopping = {
  readonly stopped: () => CallCancellation | null;
  readonly stopping: Effect.Effect<CallCancellation>;
};

export const CallDecision = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Completed'),
    operation: HostRequestRef,
    execution: ExecutionRef,
    sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Cancelled'),
    operation: HostRequestRef,
    execution: Schema.optional(ExecutionRef),
    sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    cause: CancellationCause,
    trigger: Schema.NonEmptyString,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CallDecision = typeof CallDecision.Type;

export const SourceCompletion = Schema.Struct({
  stdout: Schema.Struct({ completed: Schema.Boolean, offset: ByteOffset }),
  stderr: Schema.Struct({ completed: Schema.Boolean, offset: ByteOffset }),
});
export type SourceCompletion = typeof SourceCompletion.Type;

export const CallRetention = Schema.Literals(['retained', 'partial', 'lost']);
export type CallRetention = typeof CallRetention.Type;

export const CallDecisionAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Decided'),
    decision: CallDecision,
    nativeExit: Schema.optional(NativeExit),
    sources: SourceCompletion,
    cleanup: Cleanup,
    retention: CallRetention,
    cost: ProcessCost,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Undecided'),
    operation: HostRequestRef,
    execution: ExecutionRef,
    nativeExit: NativeExit,
    sources: SourceCompletion,
    cleanup: Cleanup,
    retention: CallRetention,
    cost: ProcessCost,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Unavailable'),
    operation: HostRequestRef,
    execution: Schema.optional(ExecutionRef),
    lastKnown: Schema.optional(CallDecision),
    reason: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CallDecisionAnswer = typeof CallDecisionAnswer.Type;
