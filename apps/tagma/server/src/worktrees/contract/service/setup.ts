import { Context, type Effect } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { SetupLaunch, SetupEnding } from '../../../executions/contract/wire/setup.js';

export class SetupSettlements extends Context.Service<
  SetupSettlements,
  { readonly on: (listener: (rootId: RootId) => Effect.Effect<void>) => () => void }
>()('tagma/worktrees/SetupSettlements') {}

export class SetupCommands extends Context.Service<
  SetupCommands,
  {
    readonly run: (launch: SetupLaunch) => Effect.Effect<SetupEnding>;
    readonly watch: (projectId: number, execution: ExecutionRef) => Effect.Effect<SetupEnding>;
  }
>()('tagma/worktrees/SetupCommands') {}
