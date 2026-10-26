import { Context, type Effect, type Scope } from 'effect';
import type { BindingId } from '@runlith/executions/protocol/custody';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { GateRefusal, RefusalBody } from '../../../platform/contract/wire/refusal.js';
import type { TerminalActor } from '../wire/terminals.js';
import type {
  DeliveryMark,
  LaneOpened,
  TerminalBox,
  TerminalDecider,
  TerminalInputReceipt,
  ViewerSource,
  ViewLeaseId,
  ViewId,
} from '../wire/viewLeases.js';
import type { TerminalRefused } from '../wire/refusals.js';
import type { TerminalFailure } from './terminals.js';

export class ViewLeases extends Context.Service<
  ViewLeases,
  {
    readonly open: (connection: number, execution: ExecutionRef, source: ViewerSource) => Effect.Effect<ViewLeaseId, TerminalRefused>;
    readonly ready: (viewer: ViewLeaseId) => Effect.Effect<boolean>;
    readonly handing: (viewer: ViewLeaseId, mark: DeliveryMark) => Effect.Effect<boolean>;
    readonly acknowledged: (connection: number, viewer: ViewLeaseId, mark: DeliveryMark) => Effect.Effect<void, TerminalRefused>;
    readonly close: (viewer: ViewLeaseId) => Effect.Effect<void>;
  }
>()('tagma/executions/ViewLeases') {}

export class ViewLanes extends Context.Service<
  ViewLanes,
  {
    readonly open: (
      actor: TerminalActor,
      projectId: number,
      execution: ExecutionRef,
      view: ViewId,
    ) => Effect.Effect<LaneOpened, TerminalFailure | GateRefusal<'terminal-view-operator'>>;
    readonly close: (projectId: number, execution: ExecutionRef, binding: BindingId) => Effect.Effect<boolean>;
    readonly listen: (
      execution: ExecutionRef,
      binding: BindingId,
      emit: (receipt: TerminalInputReceipt) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly publish: (execution: ExecutionRef, binding: BindingId, receipt: TerminalInputReceipt) => void;
    readonly turn: <A, R>(
      execution: string,
      incarnation: number,
      binding: BindingId,
      work: Effect.Effect<A, RefusalBody, R>,
    ) => Effect.Effect<A, RefusalBody, R>;
  }
>()('tagma/executions/ViewLanes') {}

export class TerminalGrids extends Context.Service<
  TerminalGrids,
  {
    readonly watch: (
      execution: ExecutionRef,
      view: ViewId,
      connection: number,
      box: TerminalBox | undefined,
      emit: (decider: TerminalDecider) => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly report: (execution: ExecutionRef, view: ViewId, connection: number, box: TerminalBox) => Effect.Effect<boolean>;
  }
>()('tagma/executions/TerminalGrids') {}
