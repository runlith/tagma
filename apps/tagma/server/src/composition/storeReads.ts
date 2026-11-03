import { join } from 'node:path';
import { type Context, Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { chain, pendingMigrations } from '../platform/store/chain.js';
import { MIGRATIONS } from '../installation/contract/wire/manifest.js';

export const storeRefusal = (stores: Context.Context<MachineStore>) =>
  Effect.fnUntraced(
    function* (root: string) {
      const folder = join(root, MIGRATIONS);
      const store = yield* MachineStore;
      return yield* pendingMigrations(store.db, chain({ folder }), folder);
    },
    (effect, root) =>
      effect.pipe(
        Effect.provideContext(stores),
        Effect.match({
          onSuccess: () => null,
          onFailure: (failure) =>
            failure._tag === 'MigrationChainInvalid'
              ? `this machine's store holds what ${root} cannot read: ${failure.disagreements.join('; ')}`
              : `this machine's store could not be compared with ${root}: ${failure.message}`,
        }),
      ),
  );
