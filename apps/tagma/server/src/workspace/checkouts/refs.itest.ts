import { expect } from 'bun:test';
import { Effect, Fiber, Queue, Stream } from 'effect';
import type { CheckoutShift, PathMove } from '../contract/service/watch.js';
import { fixture, run, rowTests } from '../testing/rowsFixture.js';

rowTests('checkouts/refs.itest.ts', (it) => {
  it.effect('sequencer-only movement preserves source inputs while accompanying tree, index and HEAD movements refresh them', () =>
    Effect.gen(function* () {
      const { rowsOver, files, paths, root, rootId, door, head, mergeBase } = yield* fixture;
      const shifts = yield* Queue.unbounded<CheckoutShift>();
      const status = yield* rowsOver({
        follow: () => Effect.succeed({ shifts: Stream.fromQueue(shifts), watching: () => true, release: () => undefined }),
      });
      const stream = yield* status.follow(rootId);
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      const notifications: [string, readonly string[] | undefined][] = [];
      status.onMark((id, named) => Effect.sync(() => void notifications.push([id, named])));
      const marker = paths.join(root, '.git', 'MERGE_HEAD');
      yield* files.writeFileString(paths.join(root, 'alone.txt'), 'x\ny\n');
      yield* files.writeFileString(marker, `${head}\n`);
      yield* Queue.offer(shifts, { movements: ['operation'], paths: new Map(), rescan: null });
      const opened = yield* Stream.runHead(stream.pipe(Stream.filter((row) => row.operation === 'merge')));
      if (opened._tag === 'None') return yield* Effect.die('the merge state was missing');
      expect(opened.value.entries).toEqual(initial.value.entries);
      expect(notifications).toEqual([]);
      yield* files.remove(marker);
      yield* Queue.offer(shifts, {
        movements: ['operation', 'tree'],
        paths: new Map<string, PathMove>([['alone.txt', 'change']]),
        rescan: null,
      });
      const closed = yield* Stream.runHead(stream.pipe(Stream.filter((row) => row.operation === 'none')));
      if (closed._tag === 'None') return yield* Effect.die('the concluded merge state was missing');
      expect(closed.value.entries.untracked.entries.find((entry) => entry.path === 'alone.txt')?.lines).toEqual({ added: 2, removed: 0 });
      expect(notifications).toEqual([[rootId, ['alone.txt']]]);
      yield* run(door.faces, root, ['add', 'alone.txt']);
      yield* files.writeFileString(marker, `${head}\n`);
      yield* Queue.offer(shifts, { movements: ['operation', 'index'], paths: new Map(), rescan: null });
      const staged = yield* Stream.runHead(stream.pipe(Stream.filter((row) => row.operation === 'merge')));
      if (staged._tag === 'None') return yield* Effect.die('the staged merge state was missing');
      expect(staged.value.entries.staged.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'held.txt']);
      expect(notifications).toEqual([
        [rootId, ['alone.txt']],
        [rootId, undefined],
      ]);
      yield* files.remove(marker);
      yield* run(door.faces, root, ['update-ref', 'refs/heads/main', mergeBase]);
      yield* Queue.offer(shifts, { movements: ['operation', 'head'], paths: new Map(), rescan: null });
      const moved = yield* Stream.runHead(stream.pipe(Stream.filter((row) => row.operation === 'none' && row.head === mergeBase)));
      if (moved._tag === 'None') return yield* Effect.die('the moved HEAD was missing');
      expect(moved.value.entries.staged.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'held.txt', 'kept.txt']);
      expect(notifications).toEqual([
        [rootId, ['alone.txt']],
        [rootId, undefined],
        [rootId, undefined],
      ]);
    }),
  );
  it.effect('a foreign ref refreshes the upstream and comparison while preserving the tree without another status', () =>
    Effect.gen(function* () {
      const { status, rootId, door, root, head } = yield* fixture;
      const stream = yield* status.follow(rootId, 'base');
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      const notifications: [string, readonly string[] | undefined][] = [];
      status.onMark((id, paths) =>
        Effect.sync(() => {
          notifications.push([id, paths]);
        }),
      );
      door.counts.readings = 0;
      yield* run(door.faces, root, ['update-ref', 'refs/heads/base', head]);
      const next = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > initial.value.revision))));
      yield* status.mark(rootId, 'refs');
      const updated = yield* Fiber.join(next);
      if (updated._tag === 'None') return yield* Effect.die('the refreshed checkout row was missing');
      expect(updated.value.head).toBe(initial.value.head);
      expect(updated.value.ahead).toBe(0);
      expect(updated.value.behind).toBe(0);
      expect(updated.value.compare?.entries).toEqual([]);
      expect(updated.value.entries).toEqual(initial.value.entries);
      expect(updated.value.coverage).toEqual(initial.value.coverage);
      expect(door.counts.readings).toBe(0);
      expect(notifications).toEqual([]);
    }),
  );
  it.effect('a ref mark that moves this checkout HEAD rereads the tree against the new commit', () =>
    Effect.gen(function* () {
      const { status, rootId, door, root, mergeBase } = yield* fixture;
      const stream = yield* status.follow(rootId, 'base');
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      const notifications: [string, readonly string[] | undefined][] = [];
      status.onMark((id, paths) =>
        Effect.sync(() => {
          notifications.push([id, paths]);
        }),
      );
      door.counts.readings = 0;
      yield* run(door.faces, root, ['update-ref', 'refs/heads/main', mergeBase]);
      const next = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > initial.value.revision))));
      yield* status.mark(rootId, 'refs');
      const updated = yield* Fiber.join(next);
      if (updated._tag === 'None') return yield* Effect.die('the refreshed checkout row was missing');
      expect(updated.value.head).toBe(mergeBase);
      expect(updated.value.entries.staged.entries.map((entry) => entry.path)).toEqual(['held.txt', 'kept.txt']);
      expect(updated.value.entries.unstaged).toEqual({
        ...initial.value.entries.unstaged,
        entries: initial.value.entries.unstaged.entries.map((entry) => ({ ...entry, mark: expect.any(Number) })),
      });
      expect(updated.value.entries.unstaged.entries[0]!.mark).toBeGreaterThan(initial.value.entries.unstaged.entries[0]!.mark!);
      expect(updated.value.compare?.entries).toEqual([]);
      expect(door.counts.readings).toBe(1);
      expect(notifications).toEqual([[rootId, undefined]]);
    }),
  );
  it.effect('two bases share the full HEAD refresh and its single tree-input invalidation', () =>
    Effect.gen(function* () {
      const { status, rootId, door, root, mergeBase } = yield* fixture;
      const first = yield* status.follow(rootId, 'base');
      const second = yield* status.follow(rootId, 'HEAD~1');
      const initial = yield* Effect.all([Stream.runHead(first), Stream.runHead(second)]);
      if (initial[0]._tag === 'None' || initial[1]._tag === 'None') return yield* Effect.die('an initial checkout row was missing');
      const before = [initial[0].value, initial[1].value];
      const notifications: [string, readonly string[] | undefined][] = [];
      status.onMark((id, paths) =>
        Effect.sync(() => {
          notifications.push([id, paths]);
        }),
      );
      door.counts.readings = 0;
      yield* run(door.faces, root, ['update-ref', 'refs/heads/main', mergeBase]);
      const next = yield* Effect.forEach([first, second], (stream, at) =>
        Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > before[at]!.revision)))),
      );
      yield* status.mark(rootId, 'refs');
      const updated = yield* Effect.forEach(next, Fiber.join);
      expect(updated.map((row) => (row._tag === 'Some' ? row.value.head : null))).toEqual([mergeBase, mergeBase]);
      expect(door.counts.readings).toBe(1);
      expect(notifications).toEqual([[rootId, undefined]]);
    }),
  );
  it.effect('an unnamed metadata rescan rereads files whose movement was not named', () =>
    Effect.gen(function* () {
      const { rowsOver, files, paths, root, rootId, door } = yield* fixture;
      const shifts = yield* Queue.unbounded<CheckoutShift>();
      const status = yield* rowsOver({
        follow: () => Effect.succeed({ shifts: Stream.fromQueue(shifts), watching: () => true, release: () => undefined }),
      });
      const stream = yield* status.follow(rootId);
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      door.counts.readings = 0;
      yield* files.writeFileString(paths.join(root, 'unnamed.txt'), 'x\n');
      const next = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > initial.value.revision))));
      yield* Queue.offer(shifts, { movements: ['refs'], paths: new Map(), rescan: 'unnamed' });
      const updated = yield* Fiber.join(next);
      if (updated._tag === 'None') return yield* Effect.die('the refreshed checkout row was missing');
      expect(updated.value.entries.untracked.entries.map((entry) => entry.path)).toContain('unnamed.txt');
      expect(updated.value.stale).toBe(false);
      expect(door.counts.readings).toBe(1);
    }),
  );
  it.effect('a failed refs refresh keeps the old row stale and recovery reads the tree afresh', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId, door } = yield* fixture;
      const stream = yield* status.follow(rootId, 'base');
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      const headPath = paths.join(root, '.git', 'HEAD');
      const head = yield* files.readFileString(headPath);
      yield* files.writeFileString(headPath, 'unreadable HEAD\n');
      const failed = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.stale))));
      yield* status.mark(rootId, 'refs');
      const stale = yield* Fiber.join(failed);
      if (stale._tag === 'None') return yield* Effect.die('the stale checkout row was missing');
      expect(stale.value.entries).toEqual(initial.value.entries);
      yield* files.writeFileString(headPath, head);
      yield* files.writeFileString(paths.join(root, 'recovered.txt'), 'x\n');
      door.counts.readings = 0;
      const next = yield* Effect.forkChild(
        Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > stale.value.revision && !row.stale))),
      );
      yield* status.mark(rootId, 'refs');
      const updated = yield* Fiber.join(next);
      if (updated._tag === 'None') return yield* Effect.die('the recovered checkout row was missing');
      expect(updated.value.entries.untracked.entries.map((entry) => entry.path)).toContain('recovered.txt');
      expect(door.counts.readings).toBe(1);
    }),
  );
});
