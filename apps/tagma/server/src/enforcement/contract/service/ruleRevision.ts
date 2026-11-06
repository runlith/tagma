import { Context, Effect, Option } from 'effect';
import type { GraphStore, StoreFailure } from '../../../platform/contract/service/store.js';
import { ActState } from '../../../graph/contract/service/transaction.js';

export class RuleRevision extends Context.Service<
  RuleRevision,
  { readonly current: (projectId: number) => Effect.Effect<string | null, StoreFailure> }
>()('tagma/enforcement/RuleRevision') {}

export const storeRevision = (store: GraphStore['Service']): RuleRevision['Service'] =>
  RuleRevision.of({
    current: (projectId) =>
      Effect.map(Effect.serviceOption(ActState), (open) =>
        Option.isSome(open) ? null : `${store.identity.path}\0${store.identity.generation}\0${projectId}\0${store.moves.total()}`,
      ),
  });
