import { Context, type Effect } from 'effect';
import type { GraphScoped } from '../../../platform/contract/service/body.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';

export type HeldTaskLabel = {
  readonly name: string;
  readonly title: string;
};

export class HeldTaskLabels
  extends Context.Service<
    HeldTaskLabels,
    {
      forHolders(
        threadIds: readonly string[],
        writer?: SessionRef,
      ): Effect.Effect<ReadonlyMap<string, readonly HeldTaskLabel[]>, StoreFailure>;
    }
  >()('tagma/change-record/HeldTaskLabels')
  implements GraphScoped
{
  declare readonly graphScoped: true;
}
