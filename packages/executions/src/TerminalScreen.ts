import { Context, type Effect } from 'effect';
import type { ExecutionRef } from './protocol/execution';
import type { ScreenAnswer, ScreenPointed, ScreenPointRead, ScreenRead } from './protocol/presentation';
import type { ExecutionsFailure } from './Executions';

export class TerminalScreen extends Context.Service<
  TerminalScreen,
  {
    readonly screen: (execution: ExecutionRef, request?: ScreenRead) => Effect.Effect<ScreenAnswer, ExecutionsFailure>;
    readonly point: (execution: ExecutionRef, request?: ScreenPointRead) => Effect.Effect<ScreenPointed, ExecutionsFailure>;
  }
>()('@runlith/executions/TerminalScreen') {}
