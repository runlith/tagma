import { Schema } from 'effect';
import { handle } from '@runlith/utils/printed';

export const InstallationId = Schema.NonEmptyString.pipe(Schema.brand('InstallationId'));
export type InstallationId = typeof InstallationId.Type;

export const ExecutionId = Schema.NonEmptyString.pipe(Schema.brand('ExecutionId')).annotate(handle());
export type ExecutionId = typeof ExecutionId.Type;

export const Incarnation = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate(handle());
export type Incarnation = typeof Incarnation.Type;

export const ExecutionRef = Schema.Struct({
  installation: InstallationId,
  execution: ExecutionId,
  incarnation: Incarnation,
});
export type ExecutionRef = typeof ExecutionRef.Type;

export const HostRequestKey = Schema.NonEmptyString.pipe(Schema.brand('HostRequestKey')).annotate(handle());
export type HostRequestKey = typeof HostRequestKey.Type;

export const HostRequestRef = Schema.Struct({
  installation: InstallationId,
  operation: HostRequestKey,
});
export type HostRequestRef = typeof HostRequestRef.Type;

export const Transport = Schema.Literals(['pipes', 'pty']);
export type Transport = typeof Transport.Type;

export const Lifetime = Schema.Literals(['call', 'held', 'command']);
export type Lifetime = typeof Lifetime.Type;

export const Purpose = Schema.Literals(['command', 'internal']);
export type Purpose = typeof Purpose.Type;

export const ExecutionTargetRef = Schema.Struct({
  environment: Schema.NonEmptyString,
  namespace: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  dependencies: Schema.Array(Schema.NonEmptyString),
});
export type ExecutionTargetRef = typeof ExecutionTargetRef.Type;

export const EnvironmentVariable = Schema.Struct({ name: Schema.NonEmptyString, value: Schema.String });
export type EnvironmentVariable = typeof EnvironmentVariable.Type;

export const EnvironmentEntry = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Set'), name: Schema.NonEmptyString, value: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Unset'), name: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.Literal('Default'), name: Schema.NonEmptyString, value: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('UnsetIf'), name: Schema.NonEmptyString, value: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type EnvironmentEntry = typeof EnvironmentEntry.Type;

export const EffectiveEnvironment = Schema.Array(EnvironmentVariable);
export type EffectiveEnvironment = typeof EffectiveEnvironment.Type;

export const ExecutionPhase = Schema.Literals(['reserved', 'queued', 'starting', 'running', 'stopping', 'ended']);
export type ExecutionPhase = typeof ExecutionPhase.Type;

export const NativeExit = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Code'), code: Schema.Int }),
  Schema.Struct({ _tag: Schema.Literal('Signal'), signal: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type NativeExit = typeof NativeExit.Type;

export const ProcessCost = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Measured'),
    cpuMicros: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    peakRssBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Unmeasured'),
    reason: Schema.Literals(['unsupported', 'failed', 'unknown']),
    detail: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type ProcessCost = typeof ProcessCost.Type;

export const StreamEnding = Schema.Literals(['open', 'eof', 'error']);
export type StreamEnding = typeof StreamEnding.Type;

export const Cleanup = Schema.Literals(['pending', 'complete', 'residual', 'unverifiable']);
export type Cleanup = typeof Cleanup.Type;

export const RecordAvailability = Schema.Literals(['available', 'gapped', 'unavailable']);
export type RecordAvailability = typeof RecordAvailability.Type;

export const ExecutionState = Schema.Struct({
  ref: ExecutionRef,
  transport: Transport,
  lifetime: Lifetime,
  purpose: Purpose,
  phase: ExecutionPhase,
  nativeExit: Schema.optional(NativeExit),
  streams: Schema.Struct({
    stdout: StreamEnding,
    stderr: StreamEnding,
    pty: StreamEnding,
  }),
  cleanup: Cleanup,
  record: RecordAvailability,
  unacquired: Schema.optional(Schema.String),
});
export type ExecutionState = typeof ExecutionState.Type;
