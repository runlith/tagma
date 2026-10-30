import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Effect } from 'effect';
import { threadRun } from '../../../threads/testing/doubles.js';
import { shelveRecord } from '../../../thread-record/testing/records.js';
import { type ThreadStoreFixture, threadStoreFixture } from '../threadStoreFixture.js';

const born = Effect.fnUntraced(function* (fixture: ThreadStoreFixture, at: number, parent?: string) {
  return yield* fixture.units.write('listWindow.birth', (unit) =>
    Effect.gen(function* () {
      const row = yield* parent === undefined
        ? fixture.store.insert({ ownerId: 'operator', agentId: 'tagma' }, unit)
        : fixture.store.insertChild(parent, { ownerId: 'operator', agentId: 'tagma' }, unit);
      yield* fixture.threads.rows.attachFacet({ threadId: row.id, projectId: fixture.projectId }, unit);
      yield* unit.run(shelveRecord(fixture.db, row.id, { readerOrderAt: new Date(at) }));
      return row.id;
    }),
  );
});

it.live('a family larger than the root window rides whole without crowding other roots out', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const root = yield* born(fixture, 3);
    const children = [yield* born(fixture, 3, root), yield* born(fixture, 3, root), yield* born(fixture, 3, root)];
    const others = [yield* born(fixture, 1), yield* born(fixture, 2)];
    const window = yield* fixture.threads.list.rootWindow('operator', [fixture.projectId], { limit: 3 });
    expect(new Set(window.rows.map((row) => row.id))).toEqual(new Set([root, ...children, ...others]));
    expect(window.rows.filter((row) => row.parentThreadId === null)).toHaveLength(3);
    expect(window.roots).toBe(3);
    expect(window.windowBefore).toBeNull();
    expect(window.rows.length).toBeGreaterThan(3);
  }),
);

it.live('the root window pages older roots with a stable total and a final null cursor', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const roots = [yield* born(fixture, 1), yield* born(fixture, 2), yield* born(fixture, 3)];
    const list = fixture.threads.list;
    const window = yield* list.rootWindow('operator', [fixture.projectId], { limit: 2 });
    expect(window.rows).toHaveLength(2);
    expect(new Set(window.rows.map((row) => row.id))).toEqual(new Set(roots.slice(1)));
    expect(window.roots).toBe(3);
    if (window.windowBefore === null) return yield* Effect.die(new Error('the window has no older-page cursor'));
    const older = yield* list.rootWindow('operator', [fixture.projectId], { limit: 2, before: window.windowBefore });
    expect(older.rows.map((row) => row.id)).toEqual(roots.slice(0, 1));
    expect(older.roots).toBe(3);
    expect(older.windowBefore).toBeNull();
  }),
);

it.live('a working child keeps its old root and idle siblings on both pages', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const old = yield* born(fixture, 0);
    const worker = yield* born(fixture, 0, old);
    const idle = yield* born(fixture, 0, old);
    const newer = [yield* born(fixture, 1), yield* born(fixture, 2)];
    yield* fixture.db.insert(threadRun()).values({ threadId: worker, ownerId: 'operator', status: 'running' });
    const list = fixture.threads.list;
    const window = yield* list.rootWindow('operator', [fixture.projectId], { limit: 2 });
    expect(new Set(window.rows.map((row) => row.id))).toEqual(new Set([old, worker, idle, newer[1]!]));
    expect(window.roots).toBe(3);
    expect(window.rows.filter((row) => row.parentThreadId === null)).toHaveLength(2);
    if (window.windowBefore === null) return yield* Effect.die(new Error('the live window has no older-page cursor'));
    const older = yield* list.rootWindow('operator', [fixture.projectId], { limit: 2, before: window.windowBefore });
    expect(new Set(older.rows.map((row) => row.id))).toEqual(new Set([old, worker, idle, newer[0]!]));
    expect(older.windowBefore).toBeNull();
  }),
);

it.live('a run with no chunks carries its recorded progress phase and timestamp into the list row', () =>
  Effect.gen(function* () {
    const fixture = yield* threadStoreFixture;
    const threadId = yield* born(fixture, 0);
    const since = (yield* Clock.currentTimeMillis) - 42_000;
    yield* fixture.db.insert(threadRun()).values({
      threadId,
      ownerId: 'operator',
      status: 'running',
      progress: { stage: 'compacting', message: 'Compacting the thread context.', phase: { phase: 'compacting', since } },
    });
    expect((yield* fixture.threads.list.summary(threadId))?.activeRun?.phase).toEqual({ phase: 'compacting', since });
  }),
);
