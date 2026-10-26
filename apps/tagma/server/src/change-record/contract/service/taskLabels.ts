import { Context, type Effect } from 'effect';
import type { GraphScoped } from '../../../platform/contract/service/body.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';

export type HeldTaskLabel = {
  readonly name: string;
  readonly title: string;
};

export class HeldTaskLabels
  extends Context.Service<
    HeldTaskLabels,
    {
      forHolders(threadIds: readonly string[]): Effect.Effect<ReadonlyMap<string, readonly HeldTaskLabel[]>, StoreFailure>;
    }
  >()('tagma/change-record/HeldTaskLabels')
  implements GraphScoped
{
  declare readonly graphScoped: true;
}
