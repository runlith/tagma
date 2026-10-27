import { Context, Effect, type FileSystem, Layer, type Scope, type Stream } from 'effect';
import { ExecutionClient } from './ExecutionClient';
import type { ExecutionFeedItem, ExecutionsFailure } from './Executions';
import type { HostAddress } from './hostAddress';
import { HostRegistration } from './HostRegistration';
import { EndpointConnection } from './EndpointConnection';
import type { CancellationCause } from './protocol/call';
import type { ExecutionRef, HostRequestRef } from './protocol/execution';
import type { InventoryChanges, InventoryRevision } from './protocol/inventory';
import type { HostCustodyRevision } from './protocol/registration';
import type { CallAnswer, ExecutionPage, ExecutionSummary, OperationAnswer, RuntimeStatus } from './protocol/runtime';
import type { ShutdownAnswer, StopAction, StopReceipt } from './protocol/stop';
import type { AuthorityAnswer, SubscriptionSource, WireLimits } from './protocol/wire';
import type { SessionBudget } from './WireSession';

export class RecoveryClient extends Context.Service<
  RecoveryClient,
  {
    readonly status: () => Effect.Effect<RuntimeStatus, ExecutionsFailure>;
    readonly list: (options?: {
      readonly after?: ExecutionRef;
      readonly limit?: number;
    }) => Effect.Effect<ExecutionPage, ExecutionsFailure>;
    readonly changes: (since: InventoryRevision, limit: number) => Effect.Effect<InventoryChanges, ExecutionsFailure>;
    readonly state: (execution: ExecutionRef) => Effect.Effect<ExecutionSummary | undefined, ExecutionsFailure>;
    readonly operation: (operation: HostRequestRef) => Effect.Effect<OperationAnswer, ExecutionsFailure>;
    readonly callResult: (operation: HostRequestRef) => Effect.Effect<CallAnswer, ExecutionsFailure>;
    readonly watch: (source: SubscriptionSource, credits: number) => Stream.Stream<ExecutionFeedItem, ExecutionsFailure>;
    readonly stop: (
      operation: HostRequestRef,
      execution: ExecutionRef,
      cause: CancellationCause,
      action: StopAction,
      trigger?: string,
    ) => Effect.Effect<StopReceipt, ExecutionsFailure>;
    readonly shutdown: (operation: HostRequestRef) => Effect.Effect<ShutdownAnswer, ExecutionsFailure>;
    readonly fenceHost: (operation: HostRequestRef, expected: HostCustodyRevision) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/RecoveryClient') {}

export const recoveryClient = (
  address: HostAddress,
  limits: WireLimits,
  budget: SessionBudget = {},
): Effect.Effect<RecoveryClient['Service'], never, FileSystem.FileSystem | HostRegistration | EndpointConnection | Scope.Scope> =>
  ExecutionClient.make({ address, role: 'recovery', limits, budget }).pipe(
    Effect.map((executions) =>
      RecoveryClient.of({
        status: executions.status,
        list: executions.list,
        changes: executions.changes,
        state: executions.state,
        operation: executions.operation,
        callResult: (operation) => executions.callResult(operation),
        watch: executions.subscribe,
        stop: executions.stop,
        shutdown: executions.shutdown,
        fenceHost: executions.fence,
      }),
    ),
  );

export const recoveryClientLayer = (
  address: HostAddress,
  limits: WireLimits,
  budget: SessionBudget = {},
): Layer.Layer<RecoveryClient, never, FileSystem.FileSystem | HostRegistration | EndpointConnection> =>
  Layer.effect(RecoveryClient, recoveryClient(address, limits, budget));
