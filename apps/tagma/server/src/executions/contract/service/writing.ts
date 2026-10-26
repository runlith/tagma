import { Context, type Effect } from 'effect';
import type { BindingId, Principal } from '@runlith/executions/protocol/custody';
import type { CustodianEpoch } from '@runlith/executions/protocol/registration';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { InputRequest, InputAnswer, InputCause, InputInstruction } from '@runlith/executions/protocol/input';
import type { InteractiveGrant } from '../wire/terminals.js';
import type { TerminalLaneRow } from '../wire/viewLeases.js';
import type { TerminalOperationKey } from '../wire/requestKeys.js';
import type { GrantRoad } from './grants.js';
import type { TerminalFailure } from './terminals.js';

export type WriterCause = InputCause | 'mouse';
export type LaneRequest = Omit<InputRequest, 'cause'> & { readonly cause: WriterCause };
export type TypedBy = { readonly writer: Principal; readonly at: number };

export type BindingOpen = {
  readonly road: GrantRoad;
  readonly projectId: number;
  readonly execution: ExecutionRef;
  readonly decisionRevision: number;
  readonly runId?: string;
};

export type OpenedBinding = {
  readonly binding: BindingId;
  readonly epoch: CustodianEpoch;
};

export type PipeHandle = {
  readonly execution: ExecutionRef;
  readonly binding: BindingId;
  readonly principal: Principal;
};

export class TerminalWriting extends Context.Service<
  TerminalWriting,
  {
    readonly input: (
      execution: ExecutionRef,
      scope: { readonly binding: BindingId; readonly principal: Principal; readonly runId?: string; readonly decisionRevision?: number },
      request: LaneRequest,
      permissionRevision: number,
    ) => Effect.Effect<InputAnswer, TerminalFailure>;
    readonly agentInput: (
      key: TerminalOperationKey,
      runId: string | undefined,
      act: InputInstruction,
      cause: InputRequest['cause'],
      profile?: number,
    ) => Effect.Effect<InputAnswer, TerminalFailure>;
    readonly pipeInput: (pipe: PipeHandle, act: InputInstruction, sequence: number) => Effect.Effect<InputAnswer, TerminalFailure>;
    readonly openHeldLane: (
      principal: Principal,
      projectId: number,
      execution: ExecutionRef,
      runId: string | undefined,
    ) => Effect.Effect<OpenedBinding, TerminalFailure>;
    readonly openBinding: (principal: Principal, open: BindingOpen) => Effect.Effect<OpenedBinding, TerminalFailure>;
    readonly openAgentBinding: (principal: Principal, open: BindingOpen) => Effect.Effect<OpenedBinding, TerminalFailure>;
    readonly closeBinding: (binding: BindingId, principal: Principal) => Effect.Effect<'fenced' | 'pending'>;
    readonly closeAgentBinding: (
      projectId: number,
      execution: ExecutionRef,
      principal: Principal,
      binding: BindingId,
      runId?: string,
    ) => Effect.Effect<'fenced' | 'pending'>;
    readonly agentGrant: (principal: Principal, binding: BindingId, runId?: string) => InteractiveGrant | undefined;
    readonly grantCounts: () => Readonly<Record<GrantRoad, number>>;
    readonly lanesOver: (projectId: number, execution: ExecutionRef) => readonly TerminalLaneRow[];
    readonly typedBy: (execution: ExecutionRef, reader: Principal | null) => Effect.Effect<readonly TypedBy[], TerminalFailure>;
  }
>()('tagma/executions/TerminalWriting') {}
