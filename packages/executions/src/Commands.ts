import { Context, type Effect } from 'effect';
import type { CommandRevisionAnswer, CommandRevisionRequest, CommandSnapshot } from './protocol/command';
import type { ExecutionRef } from './protocol/execution';
import type { CommandBatch, CommandInventory, CommandQuery, CommandRefs } from './protocol/inventory';
import type { ExecutionsFailure } from './Executions';

export class Commands extends Context.Service<
  Commands,
  {
    readonly command: (execution: ExecutionRef) => Effect.Effect<CommandSnapshot | undefined, ExecutionsFailure>;
    readonly commands: (query: CommandQuery) => Effect.Effect<CommandInventory, ExecutionsFailure>;
    readonly commandsAt: (refs: CommandRefs) => Effect.Effect<CommandBatch, ExecutionsFailure>;
    readonly revise: (request: CommandRevisionRequest) => Effect.Effect<CommandRevisionAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/Commands') {}
