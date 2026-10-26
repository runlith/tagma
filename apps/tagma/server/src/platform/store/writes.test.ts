import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Cause, Effect, Exit } from 'effect';
import { RelaxedWriteInvalid, relaxedWrites, transient } from '../contract/service/durability.js';
import { UnitWriteRefused, writes, WriteSetMode } from '../contract/service/writes.js';
import { checkStatement, recordConsequences, UnitWrites } from './writes.js';

const run = sqliteTable('run', { id: text('id').primaryKey(), status: text('status'), heartbeat: text('heartbeat_at') });
transient(run.heartbeat);
const event = sqliteTable('event', { id: text('id').primaryKey() });
const identity = { path: '/tmp/store.sqlite', generation: 1 };
const other = { path: '/tmp/store.sqlite', generation: 2 };

const checked = (set: ReturnType<typeof writes>, sql: string, mode: WriteSetMode = 'refuse', store = identity) =>
  Effect.exit(
    checkStatement(store)(sql).pipe(
      Effect.provideService(UnitWrites, new Map([[identity, set]])),
      Effect.provideService(WriteSetMode, mode),
    ),
  );

const refusal = (exit: Exit.Exit<void>) => (Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined);

it.effect('a declared table admits every column, a relaxed set only the columns it lists', () =>
  Effect.gen(function* () {
    expect(Exit.isSuccess(yield* checked(writes('runs.start', [run]), 'insert into "run" ("id", "status") values (?, ?)'))).toBe(true);
    expect(Exit.isSuccess(yield* checked(relaxedWrites('runs.beat', [run.heartbeat]), 'update "run" set "heartbeat_at" = ?'))).toBe(true);
    const widened = refusal(
      yield* checked(relaxedWrites('runs.beat', [run.heartbeat]), 'update "run" set "heartbeat_at" = ?, "status" = ?'),
    );
    expect(widened).toBeInstanceOf(UnitWriteRefused);
    expect((widened as UnitWriteRefused).reason).toBe('outside-write-set');
  }),
);

it.effect('a write outside the set, or one whose target cannot be read, is refused in refuse mode and passes in report mode', () =>
  Effect.gen(function* () {
    const set = writes('runs.start', [run]);
    expect((refusal(yield* checked(set, 'delete from "event"')) as UnitWriteRefused).table).toBe('event');
    expect((refusal(yield* checked(set, 'insert (a) values (1)')) as UnitWriteRefused).reason).toBe('unresolved-target');
    expect(Exit.isSuccess(yield* checked(set, 'delete from "event"', 'report'))).toBe(true);
  }),
);

it.effect('dropping a table needs its whole declared subject, and a column or another subject cannot authorize it', () =>
  Effect.gen(function* () {
    expect(Exit.isSuccess(yield* checked(writes('runs.retire', [run]), 'drop table "run"'))).toBe(true);
    expect((refusal(yield* checked(relaxedWrites('runs.beat', [run.heartbeat]), 'drop table "run"')) as UnitWriteRefused).reason).toBe(
      'outside-write-set',
    );
    expect((refusal(yield* checked(writes('events.retire', [event]), 'drop table "run"')) as UnitWriteRefused).table).toBe('run');
  }),
);

it.effect("joined sets widen the reach, and a statement on another store instance is not this unit's to judge", () =>
  Effect.gen(function* () {
    expect(
      Exit.isSuccess(
        yield* checked(writes('runs.close', [run], writes('events.append', [event])), 'insert into "event" ("id") values (?)'),
      ),
    ).toBe(true);
    expect(Exit.isSuccess(yield* checked(writes('runs.start', [run]), 'delete from "event"', 'refuse', other))).toBe(true);
  }),
);

it('a column its table does not declare transient cannot be declared relaxed', () => {
  expect(() => relaxedWrites('runs.edit', [run.status])).toThrow(RelaxedWriteInvalid);
});

it.effect('what a write reaches through triggers and cascading keys joins its set by the schema closure', () =>
  Effect.gen(function* () {
    recordConsequences(
      identity,
      [{ on: 'event', sql: 'CREATE TRIGGER counted AFTER INSERT ON event BEGIN UPDATE tally SET n = n + 1; END' }],
      [{ child: 'child', parent: 'run', on_update: 'NO ACTION', on_delete: 'CASCADE' }],
    );
    expect(Exit.isSuccess(yield* checked(writes('events.append', [event]), 'insert into "event" ("id") values (?)'))).toBe(true);
    expect(Exit.isSuccess(yield* checked(writes('runs.drop', [run]), 'delete from "run"'))).toBe(true);
    expect(Exit.isSuccess(yield* checked(writes('runs.start', [run]), 'insert or replace into "run" ("id") values (?)'))).toBe(true);
  }),
);

it.effect('a trigger whose writes cannot be read is refused wherever a declared write fires it', () =>
  Effect.gen(function* () {
    recordConsequences(
      identity,
      [{ on: 'run', sql: 'CREATE TRIGGER settled AFTER UPDATE OF status ON run BEGIN INSERT (a) VALUES (1); END' }],
      [],
    );
    expect(Exit.isSuccess(yield* checked(writes('runs.beat', [run]), 'UPDATE Run SET Heartbeat_At = ?'))).toBe(true);
    expect((refusal(yield* checked(writes('runs.settle', [run]), 'update run set status = ?')) as UnitWriteRefused).reason).toBe(
      'unresolved-target',
    );
  }),
);

it.effect('trigger closure preserves columns at each hop and admits a cycle without losing a different column route', () =>
  Effect.gen(function* () {
    recordConsequences(
      identity,
      [
        {
          on: 'run',
          sql: 'create trigger first after update of status on run begin update tally set n = 1; update tally set broken = 1; end',
        },
        { on: 'tally', sql: 'create trigger harmless after update of n on tally begin update run set heartbeat_at = 1; end' },
        { on: 'tally', sql: 'create trigger broken after update of broken on tally begin insert (a) values (1); end' },
        { on: 'run', sql: 'create trigger cycle after update of heartbeat_at on run begin update tally set n = 1; end' },
      ],
      [],
    );
    expect(Exit.isSuccess(yield* checked(writes('runs.beat', [run]), 'update run set heartbeat_at = ?'))).toBe(true);
    expect((refusal(yield* checked(writes('runs.settle', [run]), 'update run set status = ?')) as UnitWriteRefused).reason).toBe(
      'unresolved-target',
    );
  }),
);
