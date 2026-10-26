import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export class RuleRevision extends Context.Service<
  RuleRevision,
  { readonly current: (projectId: number) => Effect.Effect<string | null, StoreFailure> }
>()('tagma/enforcement/RuleRevision') {}
