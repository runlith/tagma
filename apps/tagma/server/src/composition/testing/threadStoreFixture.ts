import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { Clock, Context, Effect, Layer } from 'effect';
import { kind, shared } from '@runlith/testbed/worlds';
import { heldPool } from '@runlith/sqlite-process/testing/pool';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { machineFileLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { project, projectsLayer } from '../../projects/testing/doubles.js';
import { makeThreadRecords } from '../../thread-record/layer.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { fixtureMigrations } from './migrations.js';
import { ENTRY_KINDS } from './composed.js';
import { threadStack } from './threadParts.js';

const build = Effect.fnUntraced(function* (home: string) {
  const processes = yield* heldPool;
  const storage = unitsLayer(MachineUnits, MachineStore).pipe(
    Layer.provideMerge(machineFileLayer(join(home, 'threads.sqlite'), fixtureMigrations, { durable: false, readers: 1 }, processes)),
  );
  return yield* Layer.build(projectsLayer().pipe(Layer.provideMerge(storage)));
});

class ThreadStoreWorld extends Context.Service<ThreadStoreWorld, Effect.Success<ReturnType<typeof build>>>()('testing/ThreadStoreWorld') {}

const storeWorld = kind(ThreadStoreWorld, (_params: null, home) => build(home));

export const threadStoreFixture = Effect.gen(function* () {
  const standing = yield* shared(storeWorld, null);
  const store = Context.get(standing, MachineStore);
  const units = Context.get(standing, MachineUnits);
  const records = yield* Effect.provide(makeThreadRecords, standing);
  const context = Context.add(standing, ThreadRecords, records);
  const parts = yield* Effect.provide(threadStack({ db: store.db, units, records, kinds: ENTRY_KINDS }), context);
  const name = `threads-${randomUUID()}`;
  const createdAt = new Date(yield* Clock.currentTimeMillis);
  const row = yield* units.write('testing.threadStoreProject', (unit) =>
    unit.run(
      store.db
        .insert(project())
        .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt })
        .returning()
        .get(),
    ),
  );
  if (row === undefined) return yield* Effect.die(new Error('the thread fixture project was not registered'));
  yield* Effect.addFinalizer(() =>
    units
      .write('testing.threadStoreRelease', (unit) => unit.run(store.db.delete(project()).where(eq(project().id, row.id))))
      .pipe(Effect.orDie),
  );
  return { context, db: store.db, units, records, ...parts, projectId: row.id };
});

export type ThreadStoreFixture = Effect.Success<typeof threadStoreFixture>;
