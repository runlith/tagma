import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Deferred, Effect, Fiber, Layer, Queue, Stream } from 'effect';
import { Capacity, heavyPool, serverCapacity } from '../../platform/contract/service/capacity.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import type { WorktreeFeedEvent, WorktreeRow } from '../contract/wire/rows.js';
import { worktreeChannel } from './channel.js';
import { pools, MERGE_CHECKS, WORKTREE_READS } from '../capacity.js';
import { listingWorld } from '../testing/listing.js';

const machine = { parallelism: 2, memoryBytes: 8 * 1024 ** 3 };
const declarations = [heavyPool(machine), ...pools(machine)];
const width = declarations.find((pool) => pool.name === MERGE_CHECKS)?.limits.background ?? 1;
const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const world = Layer.mergeAll(storage, BunFileSystem.layer, Layer.succeed(Capacity, serverCapacity(declarations)));
const rowsOf = (event: WorktreeFeedEvent): readonly WorktreeRow[] =>
  event.kind === 'list' ? event.rows : event.kind === 'row' ? [event.row] : [];
const next = Effect.fnUntraced(function* <E>(frames: Queue.Dequeue<WorktreeFeedEvent, E>, matches: (event: WorktreeFeedEvent) => boolean) {
  for (;;) {
    const event = yield* Queue.take(frames);
    if (matches(event)) return event;
  }
});

layer(world, { excludeTestServices: true })('worktree windows', (it) => {
  it.effect(
    'the first fifty-worktree frame precedes expensive facts, visible checks share capacity, and idle verdicts survive a base-only restart',
    () =>
      Effect.gen(function* () {
        const at = yield* listingWorld(50);
        const release = yield* Deferred.make<void>();
        at.gate(Deferred.await(release));
        const oldBase = 'f'.repeat(40);
        let saved = new Map<string, WorktreeRow>();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { listing } = yield* at.open;
            const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
            yield* Effect.forkScoped(
              Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 1, limit: 4 }), (frame) =>
                Queue.offer(frames, frame),
              ),
            );
            const first = yield* next(frames, (frame) => frame.kind === 'list');
            expect(first.kind === 'list' ? [first.start, first.rows.length, first.total] : null).toEqual([1, 4, 51]);
            expect(at.calls.merges).toBe(0);
            expect([...at.calls.followed].filter((root) => root !== at.main.rootId)).toEqual([]);
            yield* next(frames, (frame) => rowsOf(frame).some((row) => row.mergeFact.state === 'queued'));
            yield* at.started(width);
            expect(at.calls.active).toBe(width);
            const mainFrames = yield* Queue.unbounded<WorktreeFeedEvent>();
            yield* Effect.forkScoped(
              Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 0, limit: 1 }), (frame) =>
                Queue.offer(mainFrames, frame),
              ),
            );
            yield* next(mainFrames, (frame) =>
              rowsOf(frame).some((row) => row.rootId === at.main.rootId && row.stateFact.state === 'current'),
            );
            expect(at.calls.active).toBe(1);
            yield* Deferred.succeed(release, undefined);
            yield* next(frames, (frame) => {
              for (const row of rowsOf(frame)) saved.set(row.rootId, row);
              return saved.size === 4 && [...saved.values()].every((row) => row.mergeFact.state === 'current');
            });
            expect(at.calls.maximum).toBeLessThanOrEqual(width);
            expect(at.calls.states.size).toBe(5);
          }),
        );
        const merges = at.calls.merges;
        at.head(at.main.rootId, 'e'.repeat(40));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { listing } = yield* at.open;
            const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
            yield* Effect.forkScoped(
              Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 1, limit: 4 }), (frame) =>
                Queue.offer(frames, frame),
              ),
            );
            const first = yield* next(frames, (frame) => frame.kind === 'list');
            expect(rowsOf(first).map((row) => [row.check, row.mergeFact.state, row.mergeFact.base])).toEqual(
              Array(4).fill(['clean', 'previous', oldBase]),
            );
            expect(at.calls.merges).toBe(merges);
          }),
        );
      }),
  );

  it.effect('a missing worktree stays in the live feed when another merge check finishes', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(2);
      const missing = at.records[0];
      const other = at.records[1];
      if (missing === undefined || other === undefined) return yield* Effect.die('the fixture has no pair of worktrees');
      const base = 'a'.repeat(40);
      const tip = 'b'.repeat(40);
      at.head(at.main.rootId, base);
      at.head(other.rootId, tip);
      const { listing, checks } = yield* at.open;
      const frames = yield* Stream.toQueue(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 0, limit: 3 }), {
        capacity: 'unbounded',
      });
      const settled = new Set<string>();
      yield* next(frames, (frame) => {
        for (const row of rowsOf(frame)) if (row.kind === 'tagma' && row.mergeFact.state === 'current') settled.add(row.rootId);
        return settled.size === 2;
      });
      at.missing(missing.rootId);
      at.moved();
      yield* next(frames, (frame) => rowsOf(frame).some((row) => row.rootId === missing.rootId && row.status === 'missing'));
      yield* checks.fresh(other.path, base, tip);
      at.placed.push({ threadId: 'working-main', rootId: at.main.rootId, state: 'working', cleared: false, movedAt: new Date(1) });
      at.threadsMoved();
      const moved = yield* next(frames, (frame) => rowsOf(frame).some((row) => row.rootId === at.main.rootId && row.agents.working === 1));
      expect(rowsOf(moved).find((row) => row.rootId === at.main.rootId)?.status).toBe('working');
      expect((yield* listing.list(7, { limit: 3 })).rows.find((row) => row.rootId === missing.rootId)?.status).toBe('missing');
    }),
  );

  it.effect('opening the same visible window starts the same git work with twenty and two hundred checkouts', () =>
    Effect.gen(function* () {
      const measured: { readonly git: ReadonlyMap<string, number>; readonly states: number; readonly merges: number }[] = [];
      for (const size of [20, 200])
        yield* Effect.scoped(
          Effect.gen(function* () {
            const at = yield* listingWorld(size);
            const { listing } = yield* at.open;
            const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
            const shown = new Map<string, WorktreeRow>();
            yield* Effect.forkScoped(
              Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 0, limit: 3 }), (frame) =>
                Queue.offer(frames, frame),
              ),
            );
            yield* next(frames, (frame) => {
              for (const row of rowsOf(frame)) shown.set(row.rootId, row);
              return (
                shown.size === 3 &&
                [...shown.values()].every(
                  (row) => row.stateFact.state === 'current' && (row.kind !== 'tagma' || row.mergeFact.state === 'current'),
                )
              );
            });
            measured.push({ git: new Map(at.calls.git), states: at.calls.states.size, merges: at.calls.merges });
          }),
        );
      expect(measured[1]).toEqual(measured[0]);
      expect(measured[0]?.states).toBe(3);
    }),
  );

  it.effect('list_worktrees chooses a page before reading state and never starts a merge check', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(200);
      const { listing } = yield* at.open;
      const first = yield* listing.list(7, { limit: 3 });
      expect([first.rows.length, first.total, first.next !== null]).toEqual([3, 201, true]);
      expect(new Set(at.calls.states.keys())).toEqual(new Set(first.rows.map((row) => row.rootId)));
      expect(at.calls.git.get('rev-list')).toBe(2);
      expect(at.calls.merges).toBe(0);
      const before = new Map(at.calls.states);
      const second = yield* listing.list(7, { limit: 3, cursor: first.next ?? undefined });
      expect(second.rows.length).toBe(3);
      const changed = [...at.calls.states].filter(([rootId, count]) => count !== (before.get(rootId) ?? 0)).map(([rootId]) => rootId);
      expect(new Set(changed)).toEqual(new Set(second.rows.map((row) => row.rootId)));
      expect(at.calls.merges).toBe(0);
    }),
  );

  it.effect('a row frozen by an act retains its current position when another row moves ahead', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(2);
      const { listing, progress } = yield* at.open;
      const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
      yield* Effect.forkScoped(
        Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 0, limit: 3, places: true }), (frame) =>
          Queue.offer(frames, frame),
        ),
      );
      const shown = new Map<string, WorktreeRow>();
      yield* next(frames, (frame) => {
        for (const row of rowsOf(frame)) shown.set(row.rootId, row);
        return shown.size === 3 && [...shown.values()].every((row) => row.stateFact.state === 'current');
      });
      const frozen = [...shown.values()].find((row) => row.index === 1);
      const other = [...shown.values()].find((row) => row.index === 2);
      if (frozen === undefined || other === undefined) return yield* Effect.die('the fixture has no ordered worktrees');
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        progress.during(7, frozen.rootId, 'pull-request', Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(release))),
      );
      yield* Deferred.await(started);
      at.placed.push({ threadId: 'waiting', rootId: other.rootId, state: 'waiting', cleared: false, movedAt: new Date(1) });
      at.threadsMoved();
      const moved = yield* next(
        frames,
        (frame) => frame.kind === 'list' && frame.rows.some((row) => row.rootId === other.rootId && row.agents.waiting === 1),
      );
      expect(moved.kind === 'list' ? moved.rows.map((row) => row.index) : []).toEqual([0, 1, 2]);
      expect(rowsOf(moved).find((row) => row.rootId === frozen.rootId)?.index).toBe(2);
      yield* Deferred.succeed(release, undefined);
    }),
  );

  it.effect('a queued state comparison keeps the captured base commit when the base ref advances', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(1);
      const { listing } = yield* at.open;
      const capacity = yield* Capacity;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        capacity.ticket(
          { name: 'fixture-state', class: 'call', needs: [{ pool: WORKTREE_READS, units: 1 }] },
          Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
        ),
      );
      yield* Deferred.await(entered);
      const pending = yield* Effect.forkScoped(listing.list(7, { limit: 2 }));
      const side = at.records[0];
      if (side === undefined) return yield* Effect.die('the fixture has no worktree');
      yield* at.probed(`${side.path}/.git`);
      at.head(at.main.rootId, 'e'.repeat(40));
      yield* Deferred.succeed(release, undefined);
      const listed = yield* Fiber.join(pending);
      const row = listed.rows.find((row) => row.rootId === side.rootId);
      expect([row?.stateFact.base, row?.diff?.added]).toEqual(['f'.repeat(40), 1]);
    }),
  );

  it.effect('a state reading admitted before retirement cannot restore its deleted durable facts', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(1);
      const { listing } = yield* at.open;
      const release = yield* Deferred.make<void>();
      at.gateRead(Deferred.await(release));
      const pending = yield* Effect.forkScoped(listing.list(7, { limit: 2 }));
      yield* at.reading;
      const side = at.records[0];
      if (side === undefined) return yield* Effect.die('the fixture has no worktree');
      yield* at.retire(side.rootId);
      yield* Deferred.succeed(release, undefined);
      const listed = yield* Fiber.join(pending);
      expect(listed.rows.find((row) => row.rootId === side.rootId)?.reading).toBe('failed');
      const restarted = yield* at.open;
      const frame = yield* Stream.runHead(worktreeChannel(restarted.listing)['worktrees.subscribe']({ projectId: 7, start: 1, limit: 1 }));
      expect(frame._tag === 'Some' ? rowsOf(frame.value)[0]?.stateFact.state : null).toBe('untaken');
    }),
  );

  it.effect('scrolling reuses the project snapshot, adds no observer, and a held or working tree gains and releases its observer', () =>
    Effect.gen(function* () {
      const at = yield* listingWorld(6);
      const { listing } = yield* at.open;
      const frames = yield* Queue.unbounded<WorktreeFeedEvent>();
      yield* Effect.forkScoped(
        Stream.runForEach(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start: 0, limit: 0, places: true }), (frame) =>
          Queue.offer(frames, frame),
        ),
      );
      yield* next(frames, (frame) => frame.kind === 'list' && frame.places?.length === 7);
      const open = (start: number) => Stream.runHead(worktreeChannel(listing)['worktrees.subscribe']({ projectId: 7, start, limit: 1 }));
      yield* open(1);
      const afterFirst = at.calls.git.get('worktree');
      yield* open(2);
      yield* open(1);
      expect(at.calls.git.get('worktree')).toBe(afterFirst);
      expect([...at.calls.followed].filter((root) => root !== at.main.rootId)).toEqual([]);
      const side = at.records[0];
      if (side === undefined) return yield* Effect.die('the fixture has no worktree');
      at.held.add(side.path);
      at.heldMoved();
      yield* at.observed(side.rootId, true);
      expect(at.calls.followed.has(side.rootId)).toBe(true);
      at.held.delete(side.path);
      at.heldMoved();
      yield* at.observed(side.rootId, false);
      at.placed.push({ threadId: 'working', rootId: side.rootId, state: 'working', cleared: false, movedAt: new Date(1) });
      at.threadsMoved();
      yield* next(frames, (frame) => frame.kind === 'places' && frame.upsert.some((place) => place.agents.working === 1));
      expect(at.calls.followed.has(side.rootId)).toBe(true);
      at.placed.splice(0);
      at.threadsMoved();
      yield* next(
        frames,
        (frame) => frame.kind === 'places' && frame.upsert.some((place) => place.rootId === side.rootId && place.agents.working === 0),
      );
      expect(at.calls.followed.has(side.rootId)).toBe(false);
    }),
  );
});
