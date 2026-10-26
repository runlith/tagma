import * as Schema from 'effect/Schema';
import { ExecutionRef, HostRequestKey, HostRequestRef } from '@runlith/executions/protocol/execution';
import { Principal, BindingId } from '@runlith/executions/protocol/custody';
import { InputAnswer } from '@runlith/executions/protocol/input';
import { StopReceipt } from '@runlith/executions/protocol/stop';
import { UncertainEffect } from '@runlith/executions/protocol/host';
import { TargetKey } from './targets.js';

export const TerminalMutation = Schema.Literals([
  'start',
  'write',
  'resize',
  'interrupt',
  'signal',
  'stop',
  'transfer',
  'control',
  'release',
  'limit',
  'resolve',
  'sweep',
]);
export type TerminalMutation = typeof TerminalMutation.Type;

export const TerminalOperationKey = Schema.Struct({
  projectId: Schema.Int,
  operationId: HostRequestKey,
  requester: Principal,
  mutation: TerminalMutation,
  targetKey: TargetKey,
  execution: Schema.optional(ExecutionRef),
});
export type TerminalOperationKey = typeof TerminalOperationKey.Type;

export const OperationKeyRetention = Schema.Struct({
  retained: Schema.Int,
  pending: Schema.Int,
  admitted: Schema.Int,
  uncertain: Schema.Int,
  settled: Schema.Int,
  expired: Schema.Int,
  ceiling: Schema.Int,
});
export type OperationKeyRetention = typeof OperationKeyRetention.Type;

export const TerminalOperationDigest = Schema.Struct({
  operation: HostRequestRef,
  mutation: Schema.optional(TerminalMutation),
  phase: Schema.Literals(['unknown', 'pending', 'admitted', 'settled', 'uncertain', 'expired']),
  execution: Schema.optional(ExecutionRef),
});
export type TerminalOperationDigest = typeof TerminalOperationDigest.Type;

export const TerminalOperationAnswer = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Whole'), state: Schema.suspend(() => TerminalOperationState) }),
  Schema.Struct({ _tag: Schema.Literal('Digest'), digest: Schema.suspend(() => TerminalOperationDigest) }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type TerminalOperationAnswer = typeof TerminalOperationAnswer.Type;

export const TerminalStartAnswer = Schema.Struct({
  operation: Schema.suspend(() => TerminalOperationAnswer),
  binding: Schema.optional(BindingId),
});
export type TerminalStartAnswer = typeof TerminalStartAnswer.Type;

export const operationPhase = (state: TerminalOperationState): TerminalOperationDigest['phase'] => {
  switch (state._tag) {
    case 'Unknown':
      return 'unknown';
    case 'Pending':
      return 'pending';
    case 'Admitted':
      return 'admitted';
    case 'Settled':
      return 'settled';
    case 'Uncertain':
      return 'uncertain';
    case 'Expired':
      return 'expired';
  }
};

export const TerminalOperationState = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Unknown'), operation: HostRequestRef }),
  Schema.Struct({ _tag: Schema.Literal('Pending'), key: TerminalOperationKey }),
  Schema.Struct({ _tag: Schema.Literal('Admitted'), key: TerminalOperationKey, execution: ExecutionRef }),
  Schema.Struct({
    _tag: Schema.Literal('Settled'),
    key: TerminalOperationKey,
    execution: Schema.optional(ExecutionRef),
    input: Schema.optional(InputAnswer),
    stop: Schema.optional(StopReceipt),
  }),
  Schema.Struct({
    _tag: Schema.Literal('Uncertain'),
    key: TerminalOperationKey,
    effect: UncertainEffect,
  }),
  Schema.Struct({ _tag: Schema.Literal('Expired'), operation: HostRequestRef, mutation: TerminalMutation }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type TerminalOperationState = typeof TerminalOperationState.Type;

export const RETAINED_DETAIL_MS = 7 * 24 * 60 * 60 * 1000;

export const RETAINED_SPENT_MS = 2 * RETAINED_DETAIL_MS;
