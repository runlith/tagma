import { join } from 'node:path';
import { Effect, Result } from 'effect';
import { readOnly } from '@runlith/sqlite-process/SqliteProcess';
import { HostManagement } from '../executions/contract/service/host.js';
import { migrationsFolder } from '../installation/closure/read.js';
import { type SuccessionPreparation, SuccessionRefused, SuccessorUnfit } from '../installation/contract/service/succession.js';
import { MIGRATIONS } from '../installation/contract/wire/manifest.js';
import type { StoreSnapshots } from '../platform/contract/service/snapshots.js';
import { MachineStore } from '../platform/contract/service/store.js';
import { chain, pendingMigrations } from '../platform/store/chain.js';
import { storesUnfitFor } from './returning.js';

export const successorPlan =
  (
    run: <A, E>(work: Effect.Effect<A, E, MachineStore | HostManagement>) => Promise<A>,
    snapshots: () => StoreSnapshots['Service'],
    storePath: string,
  ): SuccessionPreparation =>
  (next) =>
    Effect.tryPromise({
      try: () =>
        run(
          readOnly(
            Effect.gen(function* () {
              const folder = next === null ? migrationsFolder : join(next.root, MIGRATIONS);
              const store = yield* MachineStore;
              const pending = yield* pendingMigrations(store.db, chain({ folder }), folder).pipe(
                Effect.map((steps) => Result.succeed(steps)),
                Effect.catchTag('MigrationChainInvalid', (invalid) => Effect.succeed(Result.fail(invalid))),
              );
              if (Result.isFailure(pending)) return { unfit: pending.failure.message };
              const unfit = next === null ? null : yield* storesUnfitFor(storePath, next.root);
              if (unfit !== null) return { unfit };
              const heavy = yield* snapshots().estimate(store, pending.success, folder);
              return {
                migrations: pending.success.length,
                ...(heavy === null ? {} : { heavy }),
                hostState: (yield* HostManagement).connection.address.state,
              };
            }),
          ),
        ),
      catch: (cause) =>
        new SuccessionRefused({
          detail: `the successor's migration chain could not be read: ${String(cause)}`,
          reason: 'unreadable',
        }),
    }).pipe(
      Effect.flatMap((plan) =>
        'unfit' in plan
          ? Effect.fail(new SuccessorUnfit({ detail: plan.unfit ?? 'its migration chain is not this data' }))
          : Effect.succeed(plan),
      ),
    );
