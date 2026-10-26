import { join } from 'node:path';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { chain, pendingMigrations } from '../platform/store/chain.js';
import { MIGRATIONS } from '../installation/contract/wire/manifest.js';
import type { ServerRuntime } from './runtime.js';

export const storeRefusal =
  (runtime: ServerRuntime['runtime']) =>
  (root: string): Promise<string | null> =>
    runtime
      .runPromise(
        Effect.gen(function* () {
          const folder = join(root, MIGRATIONS);
          const store = yield* MachineStore;
          return yield* pendingMigrations(store.db, chain({ folder }), folder).pipe(
            Effect.as(null),
            Effect.catchTag('MigrationChainInvalid', (invalid) =>
              Effect.succeed(`this machine's store holds what ${root} cannot read: ${invalid.disagreements.join('; ')}`),
            ),
          );
        }),
      )
      .catch((cause: unknown) => `this machine's store could not be compared with ${root}: ${String(cause)}`);
