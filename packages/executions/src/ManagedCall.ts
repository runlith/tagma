import { Data, type Effect, type PlatformError } from 'effect';
import type { ChildProcessHandle } from 'effect/process/ChildProcessSpawner';
import type { ExecutionsFailure } from './Executions';
import type { CallDeadline, CallDecisionAnswer, CancellationCause } from './protocol/call';
import type { ExecutionRef, HostRequestRef } from './protocol/execution';

export const ManagedCallTypeId = '~runlith/executions/ManagedCall';
export type ManagedCallTypeId = typeof ManagedCallTypeId;

export class ManagedCallFailed extends Data.TaggedError('ManagedCallFailed')<{
  readonly operation: HostRequestRef;
  readonly execution?: ExecutionRef;
  readonly reason: 'cancelled' | 'refused' | 'uncertain' | 'unavailable';
  readonly detail: string;
  readonly result?: CallDecisionAnswer;
}> {}

export interface ManagedCall {
  readonly [ManagedCallTypeId]: ManagedCallTypeId;
  readonly operation: HostRequestRef;
  readonly execution: ExecutionRef;
  readonly deadline?: CallDeadline;
  readonly result: Effect.Effect<CallDecisionAnswer, ExecutionsFailure | PlatformError.PlatformError>;
  readonly cancel: (cause: CancellationCause, trigger: string) => Effect.Effect<void, ExecutionsFailure>;
}

export const managedCall = (handle: ChildProcessHandle): ManagedCall | undefined =>
  (handle as { readonly [ManagedCallTypeId]?: ManagedCall })[ManagedCallTypeId];

export const withManagedCall = (handle: ChildProcessHandle, call: ManagedCall): ChildProcessHandle =>
  Object.assign(handle, { [ManagedCallTypeId]: call });
