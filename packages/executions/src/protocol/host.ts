import { Schema } from 'effect';
import { Capability } from './capability';
import { ExecutionPhase, ExecutionRef, HostRequestRef } from './execution';

const refusal = <Tag extends string>(tag: Tag) => Schema.Struct({ _tag: Schema.Literal(tag), reason: Schema.String });

export const Refusal = Schema.Union([
  refusal('HostUnavailable'),
  refusal('HostConflict'),
  refusal('HostIncompatible'),
  refusal('Unauthorized'),
  refusal('AdmissionClosed'),
  Schema.Struct({ ...refusal('UnsupportedCapability').fields, capability: Schema.optional(Capability) }),
  refusal('UnknownExecution'),
  refusal('IncarnationMismatch'),
  refusal('OperationConflict'),
  refusal('CustodyConflict'),
  refusal('InputFenced'),
  refusal('InputYielding'),
  Schema.Struct({ ...refusal('InputProfileConflict').fields, expected: Schema.Int, actual: Schema.Int }),
  refusal('InterpretationUnavailable'),
  refusal('CapacityExceeded'),
  refusal('MemoryExhausted'),
  refusal('SpawnFailed'),
  refusal('HolderLost'),
  refusal('StreamMissing'),
]).pipe(Schema.toTaggedUnion('_tag'));
export type Refusal = typeof Refusal.Type;

export const CleanupObligation = Schema.Literals(['none', 'owned', 'unknown']);
export type CleanupObligation = typeof CleanupObligation.Type;

export const UncertainEffect = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('InFlight'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('StartUncertain'), operation: HostRequestRef, execution: ExecutionRef }),
  Schema.Struct({
    _tag: Schema.Literal('StoreFailed'),
    operation: HostRequestRef,
    execution: Schema.optional(ExecutionRef),
    phase: ExecutionPhase,
    cleanup: CleanupObligation,
    reason: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('NativeFailed'),
    operation: HostRequestRef,
    execution: Schema.optional(ExecutionRef),
    phase: ExecutionPhase,
    cleanup: CleanupObligation,
    reason: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type UncertainEffect = typeof UncertainEffect.Type;
