import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect, Exit } from 'effect';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { threadRows, threadRun } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';
import { ENTRY_KINDS } from '../composed.js';

it.live(
  'a held row takes a rename, a newer ended run, that run’s deletion and a heartbeat from committed row facts with no storage read, and a heartbeat alone tells no row',
  Effect.fnUntraced(function* () {
    const demo = yield* threadStoreFixture;
    const census = Context.get(demo.context, MachineStore).processes.statements;
    const counted = () =>
      new Map(
        census
          .read({ limit: 100_000 })
          .rows.filter((row) => /^select\b/i.test(row.summary))
          .map((row) => [row.fingerprint, row.statements]),
      );
    const rows = yield* threadRows(ENTRY_KINDS).pipe(Effect.provide(demo.context));
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
    const before = counted();
    expect((yield* rows.read([threadId]))[0]?.outcome?.runId).toBe('run-a');
    const hydration = [...counted()].filter(([fingerprint, statements]) => statements > (before.get(fingerprint) ?? 0));
    expect(hydration.length).toBeGreaterThan(0);

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

    const after = counted();
    expect(hydration.map(([fingerprint, statements]) => after.get(fingerprint) === statements)).toEqual(hydration.map(() => true));
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
