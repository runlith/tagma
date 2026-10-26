import { Context, type Effect, type Scope } from 'effect';
import type { ExecutionsFailure } from '@runlith/executions/Executions';
import type { BindingId, CustodyRevision } from '@runlith/executions/protocol/custody';
import type { CallBudget, CallDeadline, CancellationCause } from '@runlith/executions/protocol/call';
import type { UncertainEffect } from '@runlith/executions/protocol/host';
import type {
  ExecutionState,
  ExecutionRef,
  Incarnation,
  HostRequestRef,
  Purpose,
  Transport,
  HostRequestKey,
} from '@runlith/executions/protocol/execution';
import type { CommandEnvironmentRequest } from '@runlith/executions/CommandEnvironment';
import type { ExecutionSummary } from '@runlith/executions/protocol/runtime';
import type { TerminalGeometry } from '@runlith/executions/protocol/record';
import type { LaunchRequest, NativeProcess, StdinPolicy, StreamingOutput } from '@runlith/executions/protocol/launch';
import type { SignalAnswer, StopAction, StopReceipt } from '@runlith/executions/protocol/stop';
import type { CommandRecord } from '../wire/commands.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit } from '../../../platform/contract/service/units.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { TargetKey, ResolvedExecutionTarget } from '../wire/targets.js';
import type { TerminalRefused } from '../wire/refusals.js';
import type {
  TerminalActor,
  TerminalRow,
  TerminalListQuery,
  TerminalWaitAnswer,
  TerminalLifetime,
  TerminalRecord,
} from '../wire/terminals.js';
import type { TerminalOperationAnswer, TerminalOperationKey, TerminalOperationState, OperationKeyRetention } from '../wire/requestKeys.js';
import type { RootUseFailure } from '../../../workspace/contract/wire/uses.js';
import type { ExecutionTargetFailure, TargetRequest } from './targets.js';
import type { ExecutionStoreFailure } from '../../store/rows.js';
import type { CommandLaunch } from './commands.js';
import type { PipeHandle } from './writing.js';

export type TerminalFailure = ExecutionTargetFailure | ExecutionStoreFailure | ExecutionsFailure | RootUseFailure | StoreFailure;

export type TerminalStart = {
  readonly actor: TerminalActor;
  readonly operationId: HostRequestKey;
  readonly target: ResolvedExecutionTarget;
  readonly targetKey: TargetKey;
  readonly program: string;
  readonly args: readonly string[];
  readonly label?: string;
  readonly transport: Transport;
  readonly lifetime: TerminalLifetime;
  readonly geometry?: TerminalGeometry;
  readonly stdin?: StdinPolicy;
  readonly streaming?: StreamingOutput;
  readonly stdinHeld?: true;
  readonly environment?: CommandEnvironmentRequest;
  readonly prepared?: (launch: LaunchRequest) => Effect.Effect<void, TerminalFailure>;
  readonly purpose?: Purpose;
  readonly budget?: CallBudget;
  readonly interactive?: {
    readonly revision: number;
    readonly runId?: string;
  };
  readonly command?: CommandLaunch;
  readonly launchedFor?: ThreadId;
  readonly shellKey?: string;
};

export type TerminalStartReceipt =
  | {
      readonly _tag: 'Started';
      readonly operation: HostRequestRef;
      readonly record: TerminalRecord;
      readonly native?: NativeProcess;
      readonly deadline?: CallDeadline;
      readonly binding?: BindingId;
      readonly pipe?: PipeHandle;
    }
  | { readonly _tag: 'Refused'; readonly operation: HostRequestRef; readonly refusal: TerminalRefused }
  | { readonly _tag: 'Uncertain'; readonly operation: HostRequestRef; readonly effect: UncertainEffect }
  | { readonly _tag: 'Accepted'; readonly operation: HostRequestRef; readonly record: CommandRecord };

export type ExecutionHandle = { readonly execution: string; readonly incarnation: Incarnation };

export class Terminals extends Context.Service<
  Terminals,
  {
    readonly start: (request: TerminalStart) => Effect.Effect<TerminalStartReceipt, TerminalFailure, Scope.Scope>;
    readonly target: (request: TargetRequest) => Effect.Effect<ResolvedExecutionTarget, TerminalFailure>;
    readonly record: (executionId: string, incarnation?: Incarnation) => Effect.Effect<TerminalRecord | null, TerminalFailure>;
    readonly recordsOf: (refs: readonly ExecutionHandle[]) => Effect.Effect<ReadonlyMap<string, TerminalRecord>, TerminalFailure>;
    readonly shell: (key: string, unit?: Unit<'machine'>) => Effect.Effect<TerminalRecord | null, TerminalFailure>;
    readonly state: (execution: ExecutionRef) => Effect.Effect<ExecutionSummary | undefined, TerminalFailure>;
    readonly wait: (execution: ExecutionRef, waitMs: number) => Effect.Effect<TerminalWaitAnswer, TerminalFailure>;
    readonly signal: (execution: ExecutionRef, signal: string, expected: CustodyRevision) => Effect.Effect<SignalAnswer, TerminalFailure>;
    readonly stop: (
      projectId: number,
      key: TerminalOperationKey,
      execution: ExecutionRef,
      expected: CustodyRevision,
      cause: CancellationCause,
      action: StopAction,
    ) => Effect.Effect<StopReceipt, TerminalFailure>;
    readonly stopAsked: (execution: ExecutionRef) => Effect.Effect<boolean, TerminalFailure>;
    readonly lost: (record: TerminalRecord) => Effect.Effect<ExecutionState | null>;
    readonly inventory: (
      projectId: number,
      query: TerminalListQuery,
    ) => Effect.Effect<{ readonly terminals: readonly TerminalRow[]; readonly total: number; readonly stale: boolean }, TerminalFailure>;
  }
>()('tagma/executions/Terminals') {}

export class TerminalRequests extends Context.Service<
  TerminalRequests,
  {
    readonly request: (projectId: number, operationId: HostRequestKey) => Effect.Effect<TerminalOperationState, TerminalFailure>;
    readonly requestFor: (
      actor: TerminalActor,
      projectId: number,
      operationId: HostRequestKey,
    ) => Effect.Effect<TerminalOperationAnswer, TerminalFailure>;
    readonly retention: () => Effect.Effect<OperationKeyRetention, StoreFailure | ExecutionStoreFailure>;
  }
>()('tagma/executions/TerminalRequests') {}
