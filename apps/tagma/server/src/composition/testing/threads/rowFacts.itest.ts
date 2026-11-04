import { expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { it } from '@runlith/effect-test';
import { CostLedger, costLedgerLayer, CurrentCost } from '@runlith/performance/CostLedger';
import { eq, getTableColumns, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { Clock, Deferred, Effect, Exit } from 'effect';
import { COMMAND_RESULT_SIGNAL } from '../../../executions/contract/wire/commands.js';
import { project } from '../../../projects/testing/doubles.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import type { ThreadRows } from '../../../threads/contract/service/rows.js';
import { thread, threadInbox, threadMandate, threadRows, threadRun } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { ENTRY_KINDS } from '../composed.js';

it.live(
  'a held row takes a rename, a newer ended run, that run’s deletion and a heartbeat from committed row facts with no storage read, and a heartbeat alone tells no row',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 1 })));
    const reads = ledger.open('rowFacts.reads');
    const rows = yield* threadRows(ENTRY_KINDS).pipe(Effect.provide(demo.context), Effect.provideService(CurrentCost, reads));
    const followed = new Set<string>();
    const release = rows.retain({ wants: (place) => followed.has(place.threadId), keeps: (row) => followed.has(row.id) });
    yield* Effect.addFinalizer(() => Effect.sync(release));
    const threadId = yield* demo.units.write('rowFacts.born', (unit) =>
      Effect.gen(function* () {
        const row = yield* demo.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* demo.threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId, title: 'first' }, unit);
        return row.id;
      }),
    );
    const ended = Effect.fnUntraced(function* (id: string) {
      const finishedAt = new Date(yield* Clock.currentTimeMillis);
      yield* demo.db.insert(threadRun()).values({ id, threadId, ownerId: 'operator', status: 'completed', finishedAt });
    });
    yield* ended('run-a');

    followed.add(threadId);
    const before = reads.counts.statements;
    expect((yield* rows.read([threadId]).pipe(Effect.provideService(CurrentCost, reads)))[0]?.outcome?.runId).toBe('run-a');
    const hydration = reads.counts.statements;
    expect(hydration).toBeGreaterThan(before);

    yield* demo.units.write(demo.records.writes, (unit) => demo.records.setTitle(unit, threadId, 'renamed', 'manual'));
    yield* ended('run-b');
    expect(rows.current(threadId)).toMatchObject({ title: 'renamed', outcome: { runId: 'run-b' } });
    yield* demo.db.delete(threadRun()).where(eq(threadRun().id, 'run-b'));
    expect(rows.current(threadId)?.outcome?.runId).toBe('run-a');

    yield* demo.db.insert(threadRun()).values({ id: 'run-c', threadId, ownerId: 'operator', status: 'running' });
    expect(rows.current(threadId)?.activeRun?.id).toBe('run-c');
    const told: string[] = [];
    const stop = rows.subscribe((batch) => told.push(...batch.rows.map((row) => row.summary.id)));
    const beat = new Date((yield* Clock.currentTimeMillis) + 5_000);
    yield* demo.db.update(threadRun()).set({ heartbeatAt: beat }).where(eq(threadRun().id, 'run-c'));
    stop();
    expect(rows.current(threadId)?.activeRun?.heartbeatAt).toEqual(beat);
    expect(told).toEqual([]);

    expect(reads.counts.statements).toBe(hydration);
  }),
);

it.live(
  'two unrelated trees in two projects each read their own ancestry, activity and debt, through held rows and the narrow sets',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const name = `rowFacts-${randomUUID()}`;
    const createdAt = new Date(yield* Clock.currentTimeMillis);
    const other = yield* demo.units.write('rowFacts.project', (unit) =>
      unit.run(
        demo.db
          .insert(project())
          .values({ name, repoKey: `/${name}`, rootPath: `/${name}`, createdAt })
          .returning()
          .get(),
      ),
    );
    if (other === undefined) return yield* Effect.die(new Error('the second project was not registered'));
    yield* Effect.addFinalizer(() =>
      demo.units
        .write('rowFacts.projectRelease', (unit) => unit.run(demo.db.delete(project()).where(eq(project().id, other.id))))
        .pipe(Effect.orDie),
    );
    const spell = new Date('2026-03-01T00:00:00.000Z');
    const trees = yield* demo.units.write('rowFacts.trees', (unit) =>
      Effect.gen(function* () {
        const tree = Effect.fnUntraced(function* (projectId: number) {
          const root = yield* demo.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* demo.threads.rows.attachFacet({ threadId: root.id, projectId }, unit);
          const child = yield* demo.store.insertChild(root.id, { ownerId: 'operator', agentId: 'tagma' }, unit);
          yield* demo.threads.rows.inheritFacet({ threadId: child.id, fromThreadId: root.id, agentId: 'tagma' }, unit);
          return { root: root.id, child: child.id };
        });
        const a = yield* tree(demo.projectId);
        const b = yield* tree(other.id);
        yield* unit.run(
          demo.db.insert(threadRun()).values({ id: `run-${a.child}`, threadId: a.child, ownerId: 'operator', status: 'running' }),
        );
        yield* demo.threads.spells.begin(a.child, spell, unit);
        yield* unit.run(
          demo.db.insert(threadInbox()).values({
            id: `owed-${b.child}`,
            threadId: b.child,
            sender: { kind: 'host' },
            kind: 'signal',
            body: { type: COMMAND_RESULT_SIGNAL, addressee: 'transport', text: 'exit 0' },
            occurredAt: createdAt,
          }),
        );
        return { a, b };
      }),
    );
    const { a, b } = trees;
    const rows = yield* threadRows(ENTRY_KINDS).pipe(Effect.provide(demo.context));
    const own = (summary: NonNullable<ReturnType<ThreadRows['Service']['current']>>) => ({
      id: summary.id,
      projectId: summary.projectId,
      spell: summary.liveSpellStartedAt,
      run: summary.activeRun?.id ?? null,
      owes: summary.owes,
    });

    expect((yield* rows.read([a.root, a.child, b.root, b.child])).map(own)).toEqual([
      { id: a.root, projectId: demo.projectId, spell, run: null, owes: false },
      { id: a.child, projectId: demo.projectId, spell, run: `run-${a.child}`, owes: false },
      { id: b.root, projectId: other.id, spell: null, run: null, owes: false },
      { id: b.child, projectId: other.id, spell: null, run: null, owes: true },
    ]);
    expect([a.root, a.child, b.root, b.child].filter((id) => rows.activities().has(id))).toEqual([a.child]);
    expect(rows.activities().get(a.child)).toMatchObject({
      threadId: a.child,
      projectId: demo.projectId,
      parentThreadId: a.root,
      runId: `run-${a.child}`,
    });
    expect(yield* rows.owing([a.root, a.child, b.root, b.child])).toEqual([b.child]);
    expect(rows.waiting(a.root)).toEqual({ parentThreadId: null, waits: true, owing: false });
    expect(rows.waiting(b.root)).toEqual({ parentThreadId: null, waits: false, owing: true });
  }),
);

const SCALE = 3_000;
const ROW_BYTES = 4_096;

it.live(
  'the narrow sets and held rows of a few thousand running threads answer in a fixed number of statements and bytes per row',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const ledger = yield* CostLedger.pipe(Effect.provide(costLedgerLayer({ capacity: 2 })));
    const template = yield* demo.units.write('rowFacts.scale', (unit) =>
      Effect.gen(function* () {
        const root = yield* demo.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* demo.threads.rows.attachFacet({ threadId: root.id, projectId: demo.projectId }, unit);
        yield* unit.run(
          demo.db.insert(threadRun()).values({ id: `run-${root.id}`, threadId: root.id, ownerId: 'operator', status: 'running' }),
        );
        const copy = sql`printf('%s-%05d', ${root.id}, seq.i)`;
        const clones: readonly (readonly [SQLiteTable, SQLiteColumn, Readonly<Record<string, SQL>>])[] = [
          [threadRecord(), threadRecord().id, { id: copy, spawn_root_id: copy }],
          [thread(), thread().id, { id: copy }],
          [threadMandate(), threadMandate().id, { id: copy }],
          [threadRun(), threadRun().threadId, { id: sql`'run-' || ${copy}`, thread_id: copy }],
        ];
        for (const [table, keyed, own] of clones) {
          const columns = Object.values(getTableColumns(table)).filter((column) => column.generated === undefined);
          yield* unit.run(
            demo.db.run(sql`with recursive seq(i) as (select 1 union all select i + 1 from seq where i < ${SCALE - 1})
              insert into ${table} (${sql.join(
                columns.map((column) => sql.identifier(column.name)),
                sql`, `,
              )})
              select ${sql.join(
                columns.map((column) => own[column.name] ?? sql`${table}.${sql.identifier(column.name)}`),
                sql`, `,
              )} from ${table}, seq where ${keyed} = ${root.id}`),
          );
        }
        return root.id;
      }),
    );
    const ids = [template, ...Array.from({ length: SCALE - 1 }, (_, index) => `${template}-${String(index + 1).padStart(5, '0')}`)];

    const narrow = ledger.open('rowFacts.narrow');
    const rows = yield* threadRows(ENTRY_KINDS).pipe(Effect.provide(demo.context), Effect.provideService(CurrentCost, narrow));
    const running = rows.activities().size;
    expect(ids.every((id) => rows.activities().get(id)?.runId === `run-${id}`)).toBe(true);
    expect(narrow.counts.statements).toBeLessThanOrEqual(4);
    expect(narrow.counts.responseBytes / running).toBeLessThan(ROW_BYTES);

    const held = ledger.open('rowFacts.held');
    const summaries = yield* rows.read(ids).pipe(Effect.provideService(CurrentCost, held));
    expect(summaries.map((summary) => summary.activeRun?.id)).toEqual(ids.map((id) => `run-${id}`));
    expect(held.counts.statements).toBeLessThanOrEqual(4);
    expect(held.counts.responseBytes / SCALE).toBeLessThan(ROW_BYTES);
  }),
);

it.live(
  'a unit too large for one envelope arrives as a gap, and the held row recovers exactly from one fresh cut',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const rows = yield* threadRows(ENTRY_KINDS).pipe(Effect.provide(demo.context));
    const threadId = yield* demo.units.write('rowFacts.born', (unit) =>
      Effect.gen(function* () {
        const row = yield* demo.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit);
        yield* demo.threads.rows.attachFacet({ threadId: row.id, projectId: demo.projectId, title: 'small' }, unit);
        return row.id;
      }),
    );
    const release = rows.retain({ wants: () => false, keeps: (row) => row.id === threadId });
    yield* Effect.addFinalizer(() => Effect.sync(release));
    yield* rows.read([threadId]);
    const reset = yield* Deferred.make<void>();
    const stop = rows.subscribe((batch) => {
      if (batch.reset) Deferred.doneUnsafe(reset, Exit.void);
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
    const large = 'x'.repeat(4 * 1024 * 1024);
    yield* demo.units.write(demo.records.writes, (unit) => demo.records.setTitle(unit, threadId, large, 'manual'));
    yield* Deferred.await(reset);
    expect(rows.current(threadId)?.title).toHaveLength(large.length);
  }),
);
