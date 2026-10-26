import { Context, type Effect } from 'effect';
import type { CustodyAnswer, CustodyRequest } from './protocol/control';
import type { Principal } from './protocol/custody';
import type { ExecutionsFailure } from './Executions';

export class ExecutionCustody extends Context.Service<
  ExecutionCustody,
  {
    readonly custody: (request: CustodyRequest, principal: Principal) => Effect.Effect<CustodyAnswer, ExecutionsFailure>;
  }
>()('@runlith/executions/ExecutionCustody') {}
