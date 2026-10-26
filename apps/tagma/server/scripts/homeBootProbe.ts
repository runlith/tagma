import { Effect, Layer, ManagedRuntime } from 'effect';
import { sql } from 'drizzle-orm';
import { dirname, join } from 'node:path';
import { MachineStore } from '../src/platform/contract/service/store.js';
import { MachineUnits } from '../src/platform/contract/service/units.js';
import { storeLayer } from '../src/platform/store/open.js';
import { unitsLayer } from '../src/platform/store/units.js';
import { storeSnapshots } from '../src/platform/store/snapshot.js';
import { migrationsFolder } from '../src/installation/closure/read.js';
import { formChangeHomes } from '../src/change-record/store/homes.js';

const path = process.argv[2];
if (path === undefined) throw new Error('Pass an isolated APFS clone, never the live store.');
const started = performance.now();
const runtime = ManagedRuntime.make(
  unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(
      Layer.orDie(
        storeLayer(
          MachineStore,
          path,
          { folder: migrationsFolder, seeds: join(dirname(path), 'home-seeds'), snapshots: storeSnapshots({}) },
          { readers: 0 },
        ),
      ),
    ),
  ),
);
try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* MachineStore;
      const openedMs = performance.now() - started;
      const ledger = yield* store.db.all(sql`select name from __drizzle_migrations order by name`);
      console.log(JSON.stringify({ phase: 'opened', openedMs, schema: store.schema, ledger }));
      yield* formChangeHomes(yield* MachineUnits, store);
      const formedMs = performance.now() - started;
      const unfinished = yield* store.db.all(
        sql`select id from workspace_change indexed by workspace_change_standing_order_idx where state in ('writing', 'held') and holder <> 'operator' and holder_project_id is null limit 1`,
      );
      if (unfinished.length > 0) throw new Error('Standing changes have an unformed holder home.');
      console.log(JSON.stringify({ phase: 'standing-formed', formedMs }));
    }),
  );
} finally {
  await runtime.dispose();
}
console.log(JSON.stringify({ phase: 'closed', elapsedMs: performance.now() - started }));
