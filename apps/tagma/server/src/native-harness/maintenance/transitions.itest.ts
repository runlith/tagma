import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineStore, type MigrationChain } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { StoreSnapshots } from '../../platform/contract/service/snapshots.js';
import { unitsLayer } from '../../platform/store/units.js';
import { storeLayer } from '../../platform/store/open.js';
import { storeSnapshots } from '../../platform/store/snapshot.js';
import { chain } from '../../platform/store/chain.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { withDatabase } from '../../platform/testing/connection.js';
import { makeTransitionRetirement } from './transitions.js';

const migration = chain(fixtureMigrations).find(({ name }) => name === '20261010183425_run_transition_receipt')!;
const opening = (path: string, migrations: MigrationChain<'machine'>) =>
  unitsLayer(MachineUnits, MachineStore).pipe(Layer.provideMerge(storeLayer(MachineStore, path, migrations, { readers: 0 })));

it.live('retirement preserves a covered rename for exact restore and drains only after its snapshot is released', () =>
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'run-retirement-'))),
      (made) => Effect.promise(() => rm(made, { recursive: true, force: true })),
    );
    const path = join(root, 'tagma.sqlite');
    const folder = join(root, 'migrations');
    yield* Effect.promise(() => mkdir(join(folder, migration.name), { recursive: true }));
    yield* Effect.promise(() => writeFile(join(folder, migration.name, 'migration.sql'), migration.sql.join('--> statement-breakpoint\n')));
    const snapshots = storeSnapshots({});
    const migrations: MigrationChain<'machine'> = { folder, seeds: join(root, 'seeds'), snapshots };
    const retirement = makeTransitionRetirement.pipe(Effect.provideService(StoreSnapshots, snapshots));
    let discarded = '';
    yield* Effect.promise(() =>
      withDatabase(path, (db) =>
        Effect.gen(function* () {
          yield* db.run(sql`create table thread_run (id text primary key, status text not null, applied_seq integer not null)`);
          yield* db.run(sql`create index run_status on thread_run(status)`);
          yield* db.run(
            sql`create table thread_run_transition (run_id text not null references thread_run(id) on delete cascade, seq integer not null, request_digest text not null, plan_digest text not null, result text not null, primary key(run_id, seq))`,
          );
          yield* db.run(
            sql`create table __drizzle_migrations (id integer primary key, hash text not null, created_at integer, name text, applied_at text)`,
          );
          yield* db.run(sql`insert into thread_run values ('live', 'running', 2), ('done', 'completed', 1)`);
          const [page] = yield* db.all<{ page_size: number }>(sql`pragma page_size`);
          discarded = JSON.stringify({ answer: 'x'.repeat(page!.page_size * 4) });
          yield* db.run(
            sql`insert into thread_run_transition values ('live', 1, 'one', 'plan', ${discarded}), ('live', 2, 'two', 'plan', '{"answer":2}'), ('done', 1, 'done', 'plan', '{"answer":3}')`,
          );
        }),
      ),
    );

    yield* Effect.provide(
      Effect.gen(function* () {
        const store = yield* MachineStore;
        const units = yield* MachineUnits;
        expect(yield* store.db.all(sql`select run_id, seq, result from thread_run_receipt`)).toEqual([
          { run_id: 'live', seq: 2, result: '{"answer":2}' },
        ]);
        expect(yield* (yield* retirement).pass()).toMatchObject({ removed: 0, blockedBy: 'snapshot' });
        expect(yield* store.db.all(sql`select count(*) as n from retired_run_transition`)).toEqual([{ n: 3 }]);
        const taken = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const held = yield* Effect.forkChild(
          units.write('test.heldWriter', () => Deferred.succeed(taken, undefined).pipe(Effect.andThen(Deferred.await(release)))),
        );
        yield* Deferred.await(taken);
        const readable = yield* store.readOnly((reader) => reader.all(sql`select count(*) as n from retired_run_transition`));
        const refused = yield* Effect.result(store.readOnly((reader) => reader.run(sql`delete from retired_run_transition`)));
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(held);
        expect(readable).toEqual([{ n: 3 }]);
        expect(refused._tag).toBe('Failure');
        yield* snapshots.restore(path);
        expect(
          yield* store.db.all(sql`select run_id, seq, request_digest, plan_digest, result from thread_run_transition order by run_id, seq`),
        ).toEqual([
          { run_id: 'done', seq: 1, request_digest: 'done', plan_digest: 'plan', result: '{"answer":3}' },
          { run_id: 'live', seq: 1, request_digest: 'one', plan_digest: 'plan', result: discarded },
          { run_id: 'live', seq: 2, request_digest: 'two', plan_digest: 'plan', result: '{"answer":2}' },
        ]);
        expect(
          yield* store.db.all(sql`select name from sqlite_master where name in ('thread_run_receipt', 'thread_run_receipt_end')`),
        ).toEqual([]);
      }),
      opening(path, migrations),
    );

    yield* Effect.provide(
      Effect.gen(function* () {
        const store = yield* MachineStore;
        yield* snapshots.release(path);
        const secure = yield* store.db.all(sql`pragma secure_delete`);
        expect(yield* (yield* retirement).pass()).toMatchObject({ removed: 3 });
        expect(yield* store.db.all(sql`pragma secure_delete`)).toEqual(secure);
        expect(yield* store.db.all(sql`select name from sqlite_master where tbl_name = 'retired_run_transition'`)).toEqual([]);
      }),
      opening(path, migrations),
    );

    yield* Effect.provide(
      Effect.gen(function* () {
        const store = yield* MachineStore;
        expect(yield* store.db.all(sql`select seq from thread_run_receipt`)).toEqual([{ seq: 2 }]);
        yield* store.db.run(sql`update thread_run set status = 'completed' where id = 'live'`);
        expect(yield* store.db.all(sql`select count(*) as n from thread_run_receipt`)).toEqual([{ n: 0 }]);
        expect(yield* store.db.all(sql`select applied_seq from thread_run where id = 'live'`)).toEqual([{ applied_seq: 2 }]);
      }),
      opening(path, migrations),
    );
  }),
);
