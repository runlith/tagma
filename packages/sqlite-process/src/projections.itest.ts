import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Context, Deferred, Effect, Exit, Fiber, Layer } from 'effect';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqlClient } from 'effect/sql/SqlClient';
import { join } from 'node:path';
import { PROJECTION_BYTES, PROJECTION_CLOCK, type RowCommit, type ProjectionWrite } from './channel.js';
import { Connections, RowCommits, sqliteProcessLayer } from './SqliteProcess.js';
import { sharedPool } from './testing/pool.js';
import { Programs } from './programs.js';
import { childHosting } from './children.js';
import { ProcessPool } from './ProcessPool.js';

const Authorized = Context.Reference<ProjectionWrite>('projection-test/Authorized', { defaultValue: () => [] });
const descriptors = [
  { id: 'parent', table: 'parent', keys: ['id'], columns: ['id', 'body', 'stamp'], address: 'id', context: ['stamp'] },
  { id: 'child', table: 'child', keys: ['id'], columns: ['id', 'parent'], address: 'parent' },
] as const;

it.live('row commits capture actual keys and cascades, isolate savepoint rollback and refuse undeclared effects before commit', () =>
  Effect.gen(function* () {
    const pool = yield* sharedPool;
    const context = yield* Layer.build(
      sqliteProcessLayer(
        { filename: ':memory:', onLost: () => undefined, projectionWrite: (context) => Context.get(context, Authorized) },
        pool,
      ),
    );
    const sql = Context.get(context, SqlClient);
    const rows = Context.get(context, RowCommits);
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL, stamp INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE child (id TEXT PRIMARY KEY, parent TEXT REFERENCES parent(id) ON DELETE CASCADE ON UPDATE CASCADE)`;
    yield* sql`CREATE TRIGGER born AFTER INSERT ON parent BEGIN INSERT INTO child VALUES ('child-' || NEW.id, NEW.id); END`;
    yield* rows.install(descriptors, [
      {
        id: 'last-child',
        sql: 'SELECT id, parent FROM child WHERE parent = ?1 ORDER BY id DESC LIMIT 1',
        columns: ['id', 'parent'],
        sources: [{ projection: 'child', columns: ['id', 'parent'] }],
      },
      {
        id: 'ready-parent',
        sql: 'SELECT id, stamp FROM parent WHERE id = ?1 AND stamp > 0',
        columns: ['id', 'stamp'],
        sources: [{ projection: 'parent', columns: ['id', 'stamp'], when: '$row.stamp > 0' }],
      },
    ]);
    const commits: RowCommit[] = [];
    const stop = rows.listen((commit) => commits.push(commit));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const both = <A, E, R>(work: Effect.Effect<A, E, R>) => Effect.provideService(work, Authorized, ['parent', 'child']);
    const inserted = sql.withTransaction(sql`INSERT INTO parent VALUES ('a', 'kept', 1)`);
    const missing = yield* Effect.exit(Effect.provideService(inserted, Authorized, ['parent']));
    expect(Exit.isFailure(missing)).toBe(true);
    expect(yield* sql`SELECT id FROM parent`).toEqual([]);
    expect(commits).toEqual([]);
    yield* both(inserted);
    expect(commits[0]).toMatchObject({
      _tag: 'Complete',
      cursor: 1,
      changes: expect.arrayContaining([
        { projection: 'parent', kind: 'insert', key: ['a'], address: 'a', before: null, values: { id: 'a', body: 'kept', stamp: 1 } },
        { projection: 'child', kind: 'insert', key: ['child-a'], address: 'a', before: null, values: { id: 'child-a', parent: 'a' } },
      ]),
    });
    const selectedBefore = pool.statements.query('SELECT id, parent FROM child WHERE parent = ?1 ORDER BY id DESC LIMIT 1').statements;
    const readyBefore = pool.statements.query('SELECT id, stamp FROM parent WHERE id = ?1 AND stamp > 0').statements;
    yield* both(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`UPDATE parent SET stamp = 0 WHERE id = 'a'`;
          yield* sql`UPDATE parent SET stamp = 2 WHERE id = 'a'`;
          yield* sql`INSERT INTO child VALUES ('newest', 'a')`;
          yield* sql`DELETE FROM child WHERE id = 'newest'`;
          const aborted = yield* Effect.exit(
            sql.withTransaction(Effect.andThen(sql`UPDATE parent SET body = 'discarded' WHERE id = 'a'`, Effect.fail('abort'))),
          );
          expect(Exit.isFailure(aborted)).toBe(true);
        }),
      ),
    );
    expect(
      pool.statements.query('SELECT id, parent FROM child WHERE parent = ?1 ORDER BY id DESC LIMIT 1').statements - selectedBefore,
    ).toBe(1);
    expect(pool.statements.query('SELECT id, stamp FROM parent WHERE id = ?1 AND stamp > 0').statements - readyBefore).toBe(1);
    expect(commits[1]).toMatchObject({
      _tag: 'Complete',
      cursor: 2,
      changes: expect.arrayContaining([
        { projection: 'parent', kind: 'update', key: ['a'], address: 'a', before: 'a', values: { stamp: 2 } },
      ]),
      selected: [
        { selection: 'last-child', key: 'a', values: { id: 'child-a', parent: 'a' } },
        { selection: 'ready-parent', key: 'a', values: { id: 'a', stamp: 2 } },
      ],
    });
    yield* both(sql.withTransaction(sql`UPDATE parent SET id = 'b' WHERE id = 'a'`));
    expect(commits[2]).toMatchObject({
      _tag: 'Complete',
      cursor: 3,
      changes: expect.arrayContaining([
        expect.objectContaining({ projection: 'parent', kind: 'delete', key: ['a'] }),
        expect.objectContaining({ projection: 'parent', kind: 'insert', key: ['b'], values: { id: 'b', body: 'kept', stamp: 2 } }),
        expect.objectContaining({
          projection: 'child',
          kind: 'update',
          key: ['child-a'],
          before: 'a',
          address: 'b',
          values: { parent: 'b' },
        }),
      ]),
    });
    yield* both(sql.withTransaction(sql`DELETE FROM parent WHERE id = 'b'`));
    expect(commits[3]).toMatchObject({
      _tag: 'Complete',
      cursor: 4,
      changes: expect.arrayContaining([
        expect.objectContaining({ projection: 'parent', kind: 'delete', key: ['b'], values: { stamp: 2 } }),
        expect.objectContaining({ projection: 'child', kind: 'delete', key: ['child-a'] }),
      ]),
      selected: [
        { selection: 'last-child', key: 'b', values: null },
        { selection: 'ready-parent', key: 'b', values: null },
      ],
    });
    const undeclared = yield* Effect.exit(sql`INSERT INTO parent VALUES ('undeclared', '', 0)`);
    expect(Exit.isFailure(undeclared)).toBe(true);
    expect(commits.length).toBe(4);
    yield* both(sql`INSERT INTO parent VALUES ('outside', '', 0)`);
    expect(commits[4]).toMatchObject({
      _tag: 'Complete',
      cursor: 5,
      changes: expect.arrayContaining([
        expect.objectContaining({ projection: 'parent', kind: 'insert', key: ['outside'] }),
        expect.objectContaining({ projection: 'child', kind: 'insert', key: ['child-outside'] }),
      ]),
    });
    expect(yield* sql`SELECT id FROM parent`).toEqual([{ id: 'outside' }]);
    yield* sql`CREATE TABLE unrelated (id TEXT)`;
    yield* sql`CREATE TEMP TABLE pinned (id TEXT)`;
    yield* both(sql`UPDATE parent SET stamp = 3 WHERE id = 'outside'`);
    expect(commits[5]).toMatchObject({ _tag: 'Complete', cursor: 6 });
    yield* both(sql`INSERT INTO parent VALUES ('outside', '', 5) ON CONFLICT(id) DO UPDATE SET stamp = 5`);
    expect(commits[6]).toMatchObject({
      _tag: 'Complete',
      cursor: 7,
      selected: [{ selection: 'ready-parent', key: 'outside', values: { id: 'outside', stamp: 5 } }],
    });
    yield* both(sql`WITH chosen(id) AS (VALUES ('outside')) UPDATE parent SET stamp = 6 WHERE id IN (SELECT id FROM chosen)`);
    expect(commits[7]).toMatchObject({
      _tag: 'Complete',
      cursor: 8,
      changes: [expect.objectContaining({ projection: 'parent', kind: 'update', values: { stamp: 6 } })],
    });
    const refusedCommit = yield* both(
      Effect.gen(function* () {
        yield* sql`BEGIN`;
        yield* sql`PRAGMA defer_foreign_keys = ON`;
        yield* sql`INSERT INTO child VALUES ('orphan', 'late')`;
        const refused = yield* Effect.exit(sql`COMMIT`);
        yield* sql`INSERT INTO parent VALUES ('late', '', 0)`;
        yield* sql`COMMIT`;
        return refused;
      }),
    );
    expect(Exit.isFailure(refusedCommit)).toBe(true);
    expect(commits[8]).toMatchObject({
      _tag: 'Complete',
      cursor: 9,
      changes: expect.arrayContaining([
        expect.objectContaining({ projection: 'child', kind: 'insert', key: ['orphan'] }),
        expect.objectContaining({ projection: 'parent', kind: 'insert', key: ['late'] }),
      ]),
    });
    yield* sql`ALTER TABLE parent ADD COLUMN extra TEXT`;
    const reshaped = yield* Effect.exit(both(sql`UPDATE parent SET stamp = 4 WHERE id = 'outside'`));
    expect(Exit.isFailure(reshaped)).toBe(true);
    expect(yield* sql`SELECT stamp FROM parent WHERE id = 'outside'`).toEqual([{ stamp: 6 }]);
    expect(commits.length).toBe(9);
  }),
);

it.live('writer transport delivers bounded whole-envelope gaps and committed program order before owner continuations', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      sqliteProcessLayer({ filename: ':memory:', onLost: () => undefined }, new ProcessPool(undefined, 'stop', undefined, childHosting)),
    );
    const sql = Context.get(context, SqlClient);
    const rows = Context.get(context, RowCommits);
    const programs = Context.get(context, Programs);
    yield* sql`PRAGMA foreign_keys = ON`;
    yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL, stamp INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE child (id TEXT PRIMARY KEY, parent TEXT REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)`;
    yield* rows.install(descriptors);
    const commits: RowCommit[] = [];
    const stop = rows.listen((commit) => commits.push(commit));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const write = (id: string, body = '', expect = 1) =>
      programs.submit({
        operation: 'project',
        synchronous: null,
        program: {
          projections: ['parent'],
          statements: [{ sql: 'INSERT INTO parent VALUES (?, ?, 0)', params: [id, body], counts: 'changes', expect }],
        },
      });
    const oversized = yield* write('large', 'x'.repeat(PROJECTION_BYTES));
    expect(oversized.outcome._tag).toBe('Applied');
    expect(commits[0]).toMatchObject({ _tag: 'Gap', cursor: 1 });
    expect(yield* sql`SELECT length(body) AS size FROM parent WHERE id = 'large'`).toEqual([{ size: PROJECTION_BYTES }]);
    const denied = yield* programs.submit({
      operation: 'project',
      synchronous: null,
      program: {
        projections: [],
        statements: [{ sql: "UPDATE parent SET stamp = 1 WHERE id = 'large'", params: [], counts: 'changes', expect: 1 }],
      },
    });
    expect(denied.outcome._tag).toBe('Refused');
    const conflict = yield* write('rolled', '', 2);
    expect(conflict.outcome._tag).toBe('Conflict');
    expect(commits.length).toBe(1);
    const a = yield* Effect.forkChild(write('a'), { startImmediately: true });
    const b = yield* Effect.forkChild(write('b'), { startImmediately: true });
    yield* Fiber.join(a);
    expect(commits[1]).toMatchObject({ _tag: 'Complete', cursor: 2, changes: [expect.objectContaining({ key: ['a'] })] });
    yield* Fiber.join(b);
    expect(commits[2]).toMatchObject({ _tag: 'Complete', cursor: 3, changes: [expect.objectContaining({ key: ['b'] })] });
    const failedCommit = yield* Effect.exit(
      programs.submit({
        operation: 'project',
        synchronous: null,
        program: {
          projections: ['child'],
          statements: [{ sql: "INSERT INTO child VALUES ('orphan', 'missing')", params: [], counts: 'changes', expect: 1 }],
        },
      }),
    );
    expect(Exit.isFailure(failedCommit)).toBe(true);
    expect(commits.length).toBe(3);
    expect(yield* sql`SELECT id FROM child`).toEqual([]);
    expect(yield* sql.unsafe(`SELECT cursor FROM ${PROJECTION_CLOCK} WHERE id = ''`)).toEqual([{ cursor: 3 }]);
  }),
);

it.live('a schema restore rebinds admission and commits one reset, while rollback restores the original capture', () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      sqliteProcessLayer(
        { filename: ':memory:', onLost: () => undefined, projectionWrite: (context) => Context.get(context, Authorized) },
        yield* sharedPool,
      ),
    );
    const sql = Context.get(context, SqlClient);
    const rows = Context.get(context, RowCommits);
    yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL, stamp INTEGER NOT NULL)`;
    yield* rows.install([descriptors[0]]);
    const commits: RowCommit[] = [];
    const stop = rows.listen((commit) => commits.push(commit));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const changing = Effect.gen(function* () {
      yield* sql`DROP TABLE parent`;
      yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
      yield* rows.reset([descriptors[0]]);
      yield* sql`INSERT INTO parent VALUES ('restored', 'old schema')`;
      expect(commits).toEqual([]);
    });
    const failed = yield* Effect.exit(
      Effect.provideService(sql.withTransaction(Effect.andThen(changing, Effect.fail('abort'))), Authorized, 'effects'),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    expect(commits).toEqual([]);
    yield* Effect.provideService(sql.withTransaction(sql`INSERT INTO parent VALUES ('current', 'kept', 1)`), Authorized, ['parent']);
    expect(commits[0]).toMatchObject({
      _tag: 'Complete',
      cursor: 1,
      changes: [expect.objectContaining({ values: { id: 'current', body: 'kept', stamp: 1 } })],
    });
    const denied = yield* Effect.exit(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DROP TABLE parent`;
          yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
          yield* rows.reset([descriptors[0]]);
          yield* sql`INSERT INTO parent VALUES ('denied', '')`;
        }),
      ),
    );
    expect(Exit.isFailure(denied)).toBe(true);
    expect(commits.length).toBe(1);
    yield* Effect.provideService(
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`DROP TABLE parent`;
          yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
          yield* rows.reset([descriptors[0]]);
          yield* sql`INSERT INTO parent VALUES ('restored', 'old schema')`;
        }),
      ),
      Authorized,
      'effects',
    );
    expect(commits[1]).toMatchObject({ _tag: 'Gap', cursor: 2 });
    expect(yield* sql`SELECT * FROM parent`).toEqual([{ id: 'restored', body: 'old schema' }]);
  }),
);

it.live('a subscribed reader takes the durable cursor before its rows in one snapshot while later commits remain buffered', () =>
  Effect.gen(function* () {
    const path = join(tmpdir(), `projection-${randomUUID()}.sqlite`);
    const context = yield* Layer.build(
      sqliteProcessLayer(
        { filename: path, readers: 1, onLost: () => undefined, projectionWrite: (context) => Context.get(context, Authorized) },
        yield* sharedPool,
      ),
    );
    const sql = Context.get(context, SqlClient);
    const rows = Context.get(context, RowCommits);
    const connections = Context.get(context, Connections);
    yield* sql`CREATE TABLE parent (id TEXT PRIMARY KEY, body TEXT NOT NULL, stamp INTEGER NOT NULL)`;
    yield* rows.install([descriptors[0]]);
    const commits: RowCommit[] = [];
    const stop = rows.listen((commit) => commits.push(commit));
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const at = yield* Deferred.make<void>();
    const later = yield* Deferred.make<void>();
    const reading = yield* Effect.forkChild(
      connections.readSnapshot((reader) =>
        Effect.gen(function* () {
          const [clock] = yield* reader.run(sql.unsafe<{ cursor: number }>(`SELECT cursor FROM ${PROJECTION_CLOCK} WHERE id = ''`));
          yield* Deferred.succeed(at, undefined);
          yield* Deferred.await(later);
          const stored = yield* reader.run(sql`SELECT id FROM parent`);
          return { cursor: clock!.cursor, rows: stored };
        }),
      ),
    );
    yield* Deferred.await(at);
    yield* Effect.provideService(sql.withTransaction(sql`INSERT INTO parent VALUES ('later', '', 0)`), Authorized, ['parent']);
    yield* Deferred.succeed(later, undefined);
    expect(yield* Fiber.join(reading)).toEqual({ cursor: 0, rows: [] });
    expect(commits).toEqual([expect.objectContaining({ _tag: 'Complete', cursor: 1 })]);
    expect(yield* sql`SELECT id FROM parent`).toEqual([{ id: 'later' }]);
  }),
);
