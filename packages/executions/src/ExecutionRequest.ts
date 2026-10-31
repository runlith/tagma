import { Context, type Effect } from 'effect';
import type { ExecutionRef, HostRequestRef } from './protocol/execution';
import type { StopPrevention } from './protocol/stop';
import type { CallAnswer, OperationAnswer } from './protocol/runtime';
import type { ExecutionsFailure } from './Executions';

export class ExecutionRequest extends Context.Service<
  ExecutionRequest,
  {
    readonly operation: (operation: HostRequestRef) => Effect.Effect<OperationAnswer, ExecutionsFailure>;
    readonly preventStop: (operation: HostRequestRef, execution: ExecutionRef) => Effect.Effect<StopPrevention, ExecutionsFailure>;
    readonly callResult: (
      operation: HostRequestRef,
      options?: { readonly waitMs?: number },
    ) => Effect.Effect<CallAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/ExecutionRequest') {}
