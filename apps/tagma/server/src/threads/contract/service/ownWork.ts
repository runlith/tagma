import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export class OwnWork extends Context.Service<
  OwnWork,
  {
    readonly owing: (threads?: readonly string[]) => Effect.Effect<readonly string[], StoreFailure>;
    readonly endings: ReadonlySet<string>;
  }
>()('tagma/threads/OwnWork') {}
