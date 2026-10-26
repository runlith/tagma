import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sql, type SQL } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Effect, Layer } from 'effect';
import { MachineStore } from '../contract/service/store.js';
import { MachineUnits } from '../contract/service/units.js';
import { writes } from '../contract/service/writes.js';
import { seededStoreLayer } from './open.js';
import { unitsLayer } from './units.js';
import { readConsequences } from './writes.js';

const watched = sqliteTable('moves_watched', { id: text('id').primaryKey() });
const other = sqliteTable('moves_other', { id: text('id').primaryKey() });
const apart = sqliteTable('moves_apart', { id: text('id').primaryKey() });

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(Layer.orDie(seededStoreLayer(MachineStore, fixtureMigrations))),
);

const world = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  yield* store.db.run(sql`create table moves_other (id text primary key)`);
  yield* store.db.run(sql`create table moves_apart (id text primary key)`);
  yield* store.db.run(sql`create table moves_watched (id text primary key, other text references moves_other(id) on delete cascade)`);
  yield* readConsequences(store.identity, store.db);
  const counted = { reads: 0 };
  const count = store.moves.answers<string, number>([watched]).read(
    'all',
    units.read((unit) =>
      Effect.map(unit.run(store.db.all(sql`select id from moves_watched`)), (rows) => {
        counted.reads += 1;
        return rows.length;
      }),
    ),
  );
  const run = (statement: SQL) => store.db.run(statement);
  return { store, units, count, counted, run };
});

it.live('a held answer outlives commits of other tables and rollbacks of its own, and an open unit reads around it', () =>
  Effect.gen(function* () {
    const { units, count, counted, run } = yield* world;
    const seen = [yield* count, yield* count];
    yield* units.write(writes('moves.apart', [apart]), (unit) => unit.run(run(sql`insert into moves_apart (id) values ('a')`)));
    seen.push(yield* count);
    yield* Effect.exit(
      units.write(writes('moves.rolledBack', [watched]), (unit) =>
        Effect.gen(function* () {
          yield* unit.run(run(sql`insert into moves_watched (id) values ('r')`));
          seen.push(yield* count);
          return yield* Effect.fail('rolled back');
        }),
      ),
    );
    seen.push(yield* count);
    expect({ seen, reads: counted.reads }).toEqual({ seen: [0, 0, 0, 1, 0], reads: 2 });
  }).pipe(Effect.provide(storage)),
);

it.live('every table a committed unit reached has moved before its commit tails run, nested units and cascades included', () =>
  Effect.gen(function* () {
    const { units, count, counted, run } = yield* world;
    const seen = [yield* count];
    yield* units.write(writes('moves.outer', [other]), (outer) =>
      Effect.gen(function* () {
        yield* outer.afterCommit(Effect.orDie(Effect.flatMap(count, (now) => Effect.sync(() => void seen.push(now)))));
        yield* outer.run(run(sql`insert into moves_other (id) values ('a')`));
        yield* units.write(writes('moves.inner', [watched]), (inner) =>
          inner.run(run(sql`insert into moves_watched (id, other) values ('w', 'a')`)),
        );
      }),
    );
    seen.push(yield* count);
    yield* units.write(writes('moves.parent', [other]), (unit) => unit.run(run(sql`delete from moves_other where id = 'a'`)));
    seen.push(yield* count);
    expect({ seen, reads: counted.reads }).toEqual({ seen: [0, 1, 1, 0], reads: 3 });
  }).pipe(Effect.provide(storage)),
);
