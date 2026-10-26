import { Context, type Effect } from 'effect';
import type { BindingId, Principal } from './protocol/custody';
import type { ExecutionRef } from './protocol/execution';
import type { InputAnswer, InputRequest } from './protocol/input';
import type { AuthorityAnswer, BindingScope } from './protocol/wire';
import type { ExecutionsFailure } from './Executions';

export class TerminalInput extends Context.Service<
  TerminalInput,
  {
    readonly input: (execution: ExecutionRef, scope: BindingScope, request: InputRequest) => Effect.Effect<InputAnswer, ExecutionsFailure>;
    readonly openBinding: (principal: Principal, execution?: ExecutionRef) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
    readonly closeBinding: (binding: BindingId, principal: Principal) => Effect.Effect<AuthorityAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/TerminalInput') {}
