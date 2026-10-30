import { expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from '@runlith/effect-test';
import { Effect, Layer } from 'effect';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { sql } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { storeLayer } from '../../platform/store/open.js';
import { unitsLayer } from '../../platform/store/units.js';
import { formChangeHomes } from './homes.js';

const storage = Layer.unwrap(
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), 'change-homes-'))),
      (root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
    ),
    (root) => {
      const migration = join(root, '20261010000000_home');
      mkdirSync(migration);
      writeFileSync(
        join(migration, 'migration.sql'),
        [
          'CREATE TABLE thread (id TEXT PRIMARY KEY, project_id INTEGER)',
          'CREATE TABLE project_root (root_id TEXT NOT NULL, project_id INTEGER NOT NULL)',
          'CREATE TABLE workspace_change (id TEXT PRIMARY KEY, project_id INTEGER NOT NULL, holder_project_id INTEGER, holder TEXT NOT NULL, checkout TEXT NOT NULL, state TEXT NOT NULL, after_hash TEXT, commit_sha TEXT)',
          'CREATE INDEX workspace_change_holder_idx ON workspace_change(holder)',
          "CREATE INDEX workspace_change_standing_order_idx ON workspace_change(checkout) WHERE state IN ('writing', 'held')",
        ].join('\n--> statement-breakpoint\n'),
      );
      return unitsLayer(MachineUnits, MachineStore).pipe(
        Layer.provideMerge(
          Layer.orDie(storeLayer(MachineStore, ':memory:', { folder: root, seeds: join(root, 'seeds') }, { readers: 0 }, sharedPool)),
        ),
      );
    },
  ),
);

it.live('standing rows form before startup readers; history forms only for its requested holder and then reads without a write', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.run(sql`INSERT INTO thread VALUES ('a', 1), ('b', 2)`);
    yield* store.db.run(sql`INSERT INTO project_root VALUES ('main-a', 1), ('main-a', 2), ('main-b', 2)`);
    yield* store.db.run(sql`INSERT INTO workspace_change VALUES
        ('foreign', 1, NULL, 'a', 'main-b', 'held', 'foreign-bytes', NULL),
        ('landed', 2, NULL, 'a', 'main-b', 'committed', 'landed-bytes', 'sha'),
        ('operator', 2, NULL, 'operator', 'main-b', 'held', 'operator-bytes', NULL),
        ('deleted', 2, NULL, 'gone', 'main-b', 'withdrawn', 'gone-bytes', NULL),
        ('checkout-gone', 1, NULL, 'a', 'removed', 'writing', 'waiting-bytes', NULL)`);
    yield* formChangeHomes(units, store);
    const live = yield* store.db.all(sql`SELECT id, project_id, holder_project_id FROM workspace_change ORDER BY id`);
    expect(live).toEqual([
      { id: 'checkout-gone', project_id: 1, holder_project_id: 1 },
      { id: 'deleted', project_id: 2, holder_project_id: null },
      { id: 'foreign', project_id: 2, holder_project_id: 1 },
      { id: 'landed', project_id: 2, holder_project_id: null },
      { id: 'operator', project_id: 2, holder_project_id: null },
    ]);
    yield* formChangeHomes(units, store, 'a');
    yield* units.markReadOnly(formChangeHomes(units, store, 'a'));
    const landed = yield* store.db.all(sql`SELECT holder_project_id, after_hash, commit_sha FROM workspace_change WHERE id = 'landed'`);
    expect(landed).toEqual([{ holder_project_id: 1, after_hash: 'landed-bytes', commit_sha: 'sha' }]);
    yield* formChangeHomes(units, store, 'gone');
    expect(yield* store.db.all(sql`SELECT holder_project_id, after_hash FROM workspace_change WHERE id = 'deleted'`)).toEqual([
      { holder_project_id: 2, after_hash: 'gone-bytes' },
    ]);
    yield* units.markReadOnly(formChangeHomes(units, store));
  }).pipe(Effect.provide(storage)),
);

it.live('an unresolved checkout aborts home formation atomically and the repaired holder can form', () =>
  Effect.gen(function* () {
    const store = yield* MachineStore;
    const units = yield* MachineUnits;
    yield* store.db.run(sql`INSERT INTO thread VALUES ('a', 3)`);
    yield* store.db.run(sql`INSERT INTO project_root VALUES ('shared', 1), ('shared', 2)`);
    yield* store.db.run(sql`INSERT INTO workspace_change VALUES ('row', 3, NULL, 'a', 'shared', 'held', 'kept', NULL)`);
    const refused = yield* Effect.result(formChangeHomes(units, store, 'a'));
    expect(refused._tag).toBe('Failure');
    expect(yield* store.db.all(sql`SELECT project_id, holder_project_id FROM workspace_change`)).toEqual([
      { project_id: 3, holder_project_id: null },
    ]);
    yield* store.db.run(sql`INSERT INTO project_root VALUES ('shared', 3)`);
    yield* formChangeHomes(units, store, 'a');
    expect(yield* store.db.all(sql`SELECT project_id, holder_project_id FROM workspace_change`)).toEqual([
      { project_id: 3, holder_project_id: 3 },
    ]);
  }).pipe(Effect.provide(storage)),
);
