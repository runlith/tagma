import { Context, type Effect } from 'effect';
import type { Actor } from '../../../platform/contract/wire/actor.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ThreadExecution } from '../../../native-harness/contract/service/execution.js';

export class OperationChecks extends Context.Service<
  OperationChecks,
  {
    run<A, E, R>(
      id: string,
      actor: Exclude<Actor, { readonly kind: 'operator' | 'external' }>,
      work: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | GateRefusal, R>;
    afterEdit: ThreadExecution['Service']['afterEdit'];
  }
>()('tagma/invocation/OperationChecks') {}
