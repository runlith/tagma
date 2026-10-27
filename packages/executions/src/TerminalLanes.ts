import { Context, type Effect, type Stream } from 'effect';
import type { ExecutionRef } from './protocol/execution';
import type { LaneInput, TerminalLane } from './protocol/lane';
import type { BindingScope } from './protocol/wire';
import type { ExecutionsFailure } from './Executions';

export class TerminalLanes extends Context.Service<
  TerminalLanes,
  {
    readonly open: (execution: ExecutionRef, claim: BindingScope) => Effect.Effect<TerminalLane, ExecutionsFailure>;
    readonly inputs: (execution: ExecutionRef) => Stream.Stream<LaneInput, ExecutionsFailure>;
  }
>()('@runlith/executions/TerminalLanes') {}
