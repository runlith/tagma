import { expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import type { CheckoutState } from '../contract/wire/checkout.js';
import { RootId } from '../contract/wire/ids.js';
import { fixture, pause, provenance, run, rowTests } from '../testing/rowsFixture.js';

rowTests('checkouts/rows.itest.ts', (it) => {
  it.effect('one reading answers each area with its own weight, and the upstream comparison beside it', () =>
    Effect.gen(function* () {
      const { status, rootId, head, mergeBase, root, paths } = yield* fixture;
      const index = paths.join(root, '.git', 'index');
      const before = statSync(index);
      const row = yield* status.read(rootId);
      const after = statSync(index);
      expect([after.ino, after.mtimeMs]).toEqual([before.ino, before.mtimeMs]);
      expect(row.revision).toBe(1);
      expect(row.stale).toBe(false);
      expect(row.incomplete).toBe(false);
      expect(row.head).toBe(head);
      expect(row.ref).toBe('main');
      expect(row.upstream).toBe('base');
      expect(row.ahead).toBe(1);
      expect(row.behind).toBe(0);
      expect(row.operation).toBe('none');
      expect(row.coverage).toEqual({ untracked: 'all', paths: null });
      expect(row.entries.staged).toEqual({
        entries: [{ path: 'held.txt', status: 'modified', lines: { added: 1, removed: 0 } }],
        added: 1,
        removed: 0,
      });
      expect(row.entries.unstaged).toEqual({
        entries: [{ path: 'kept.txt', status: 'modified', lines: { added: 1, removed: 0 } }],
        added: 1,
        removed: 0,
      });
      expect(row.entries.untracked).toEqual({
        entries: [
          { path: 'alone.txt', status: 'untracked', lines: { added: 1, removed: 0 } },
          { path: 'fresh.txt', status: 'untracked', lines: { added: 3, removed: 0 } },
        ],
        added: 4,
        removed: 0,
      });
      expect(row.entries.unmerged.entries).toEqual([]);
      expect(row.compare).toEqual({
        base: 'base',
        mergeBase,
        head,
        entries: [{ path: 'kept.txt', status: 'modified', lines: { added: 1, removed: 0 } }],
        added: 1,
        removed: 0,
      });
    }),
  );
  it.effect('a named tree mark reads only its path and keeps the other entries', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId, door } = yield* fixture;
      const stream = yield* status.follow(rootId, 'base');
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      door.commands.length = 0;
      yield* files.writeFileString(paths.join(root, 'kept.txt'), 'one\ntwo\nthree\nfour\n');
      const next = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > initial.value.revision))));
      yield* status.mark(rootId, 'tree', ['kept.txt']);
      const updated = yield* Fiber.join(next);
      if (updated._tag === 'None') return yield* Effect.die('the scoped checkout row was missing');
      expect(door.commands.filter((args) => args.includes('--porcelain=v2')).map((args) => args.slice(-2))).toEqual([
        ['--', ':(literal)kept.txt'],
      ]);
      expect(door.commands.filter((args) => args.includes('--numstat')).map((args) => args.slice(-2))).toEqual([
        ['--', ':(literal)kept.txt'],
      ]);
      expect(updated.value.coverage.paths).toBeNull();
      expect(updated.value.entries.staged.entries.map((entry) => entry.path)).toEqual(['held.txt']);
      expect(updated.value.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt']);
      expect(updated.value.entries.unstaged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
    }),
  );
  it.effect('marks arriving during a reading cost exactly one more, and the row that follows carries them', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId, door } = yield* fixture;
      const first = yield* pause;
      door.hold(first);
      const rows = yield* Effect.forkChild(Stream.runCollect(Stream.take(status.subscribe(rootId), 2)));
      yield* Deferred.await(first.arrived);
      yield* files.writeFileString(paths.join(root, 'later.txt'), 'x\n');
      yield* status.mark(rootId);
      yield* status.mark(rootId);
      const second = yield* pause;
      door.hold(second);
      yield* Deferred.succeed(first.gate, undefined);
      yield* Deferred.await(second.arrived);
      expect(door.counts.readings).toBe(2);
      yield* Deferred.succeed(second.gate, undefined);
      const seen = yield* Fiber.join(rows);
      expect(seen.map((row) => row.revision)).toEqual([1, 2]);
      expect(seen[0]?.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt']);
      expect(seen[1]?.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt', 'later.txt']);
    }),
  );
  it.effect('two subscribers of one root share its reading, and a released root is read no more', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const held = yield* pause;
      door.hold(held);
      const first = yield* Effect.forkChild(Stream.runCollect(Stream.take(status.subscribe(rootId), 1)));
      yield* Deferred.await(held.arrived);
      const second = yield* Effect.forkChild(Stream.runCollect(Stream.take(status.subscribe(rootId), 1)));
      yield* Deferred.succeed(held.gate, undefined);
      expect((yield* Fiber.join(first)).length).toBe(1);
      expect((yield* Fiber.join(second)).length).toBe(1);
      expect(door.counts.readings).toBe(1);
      const spawned = door.counts.spawns;
      yield* status.mark(rootId);
      expect(door.counts.spawns).toBe(spawned);
    }),
  );
  it.effect('a mark of a checkout re-reads the reading standing over it, and a mark of another checkout re-reads none', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const seen = yield* Deferred.make<void>();
      yield* Effect.forkChild(
        Stream.runForEach(
          Stream.tap(status.subscribe(rootId), () => Deferred.succeed(seen, undefined)),
          () => Effect.void,
        ),
      );
      yield* Deferred.await(seen);
      expect(door.counts.readings).toBe(1);
      yield* status.mark(RootId.make('another-root'), 'written');
      expect(door.counts.readings).toBe(1);
      const held = yield* pause;
      door.hold(held);
      yield* status.mark(rootId, 'written');
      yield* Deferred.await(held.arrived);
      expect(door.counts.readings).toBe(2);
      yield* Deferred.succeed(held.gate, undefined);
    }),
  );
  it.effect('a write marked on a checkout nobody reads still reaches the mark listeners, and reads nothing', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const told: (readonly string[] | undefined)[] = [];
      const detach = status.onMark((_rootId, paths) => Effect.sync(() => void told.push(paths)));
      yield* status.mark(rootId, 'written', ['src/a.ts']);
      detach();
      expect(told).toEqual([['src/a.ts']]);
      expect(door.counts.readings).toBe(0);
    }),
  );
  it.effect('a mark naming an ignore file re-reads the paths whose standing it moves', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId } = yield* fixture;
      yield* files.writeFileString(paths.join(root, 'build.log'), 'x\n');
      const listed = (row: CheckoutState) => row.entries.untracked.entries.map((entry) => entry.path);
      const seen = yield* Deferred.make<void>();
      const rows = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.takeUntil(
            Stream.tap(status.subscribe(rootId), () => Deferred.succeed(seen, undefined)),
            (row) => !listed(row).includes('build.log'),
          ),
        ),
      );
      yield* Deferred.await(seen);
      yield* files.writeFileString(paths.join(root, '.gitignore'), '*.log\n');
      yield* status.mark(rootId, 'written', ['.gitignore']);
      const read = yield* Fiber.join(rows);
      const seenPaths = read.map(listed);
      expect(seenPaths.at(0)).toContain('build.log');
      expect(seenPaths.at(-1)).not.toContain('build.log');
    }),
  );
  it.effect('a byte written into the tree outside the doors moves the row, and the row says it is watched', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId } = yield* fixture;
      const seen = yield* Deferred.make<void>();
      const rows = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(rootId), () => Deferred.succeed(seen, undefined)),
            2,
          ),
        ),
      );
      yield* Deferred.await(seen);
      yield* files.writeFileString(paths.join(root, 'typed.txt'), 'y\n');
      const [before, after] = yield* Fiber.join(rows);
      expect(before?.unwatched).toBe(false);
      expect(after?.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt', 'typed.txt']);
      expect(after?.unwatched).toBe(false);
    }),
  );
  it.effect('a named base is what the comparison measures against, and an unknown one loses only the comparison', () =>
    Effect.gen(function* () {
      const { status, rootId, door, root } = yield* fixture;
      yield* run(door.faces, root, ['commit', '-q', '-m', 'a third']);
      const recent = yield* status.read(rootId, 'HEAD~1');
      expect(recent.compare?.base).toBe('HEAD~1');
      expect(recent.compare?.entries.map((entry) => entry.path)).toEqual(['held.txt']);
      const born = yield* status.read(rootId, 'HEAD~2');
      expect(born.compare?.base).toBe('HEAD~2');
      expect(born.compare?.entries.map((entry) => entry.path).sort()).toEqual(['held.txt', 'kept.txt']);
      const named = yield* status.read(rootId, 'base');
      expect(named.compare?.base).toBe('base');
      expect(named.compare?.entries.map((entry) => entry.path).sort()).toEqual(['held.txt', 'kept.txt']);
      const unknown = yield* status.read(rootId, 'no-such-ref');
      expect(unknown.compare).toBeNull();
      expect(unknown.unresolvedBase).toBe('no-such-ref');
      expect(named.unresolvedBase).toBeNull();
      expect(unknown.stale).toBe(false);
      expect(unknown.ref).toBe('main');
      expect(unknown.entries.unstaged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
      expect(unknown.entries.untracked.entries.map((entry) => entry.path)).toEqual(['alone.txt', 'fresh.txt']);
    }),
  );
  it.effect('two bases over one checkout are two rows, and one write moves both', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId } = yield* fixture;
      const ready = yield* Effect.all({ upstream: Deferred.make<void>(), born: Deferred.make<void>() });
      const upstream = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(rootId), () => Deferred.succeed(ready.upstream, undefined)),
            2,
          ),
        ),
      );
      const born = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(rootId, 'HEAD~1'), () => Deferred.succeed(ready.born, undefined)),
            2,
          ),
        ),
      );
      yield* Effect.all([Deferred.await(ready.upstream), Deferred.await(ready.born)]);
      yield* files.writeFileString(paths.join(root, 'typed.txt'), 'y\n');
      const [, afterUpstream] = yield* Fiber.join(upstream);
      const [, afterBorn] = yield* Fiber.join(born);
      expect(afterUpstream?.compare?.base).toBe('base');
      expect(afterBorn?.compare?.base).toBe('HEAD~1');
      for (const row of [afterUpstream, afterBorn]) {
        expect(row?.entries.untracked.entries.map((entry) => entry.path)).toContain('typed.txt');
      }
    }),
  );
  it.effect('one reading of a held root spends a countable number of git processes', () =>
    Effect.gen(function* () {
      const { files, paths, root, door, status, rootId } = yield* fixture;
      const seen = yield* Deferred.make<void>();
      const rows = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(rootId), () => Deferred.succeed(seen, undefined)),
            2,
          ),
        ),
      );
      yield* Deferred.await(seen);
      door.counts.spawns = 0;
      door.counts.readings = 0;
      yield* files.writeFileString(paths.join(root, 'typed.txt'), 'y\n');
      yield* Fiber.join(rows);
      expect(door.counts.readings).toBeGreaterThan(0);
      expect(door.counts.spawns).toBeLessThanOrEqual(door.counts.readings * 5);
    }),
  );
  it.effect('a linked worktree stages outside its own tree, and the row still moves', () =>
    Effect.gen(function* () {
      const { files, paths, home, root, door, roots, status } = yield* fixture;
      const git = door.faces;
      const linked = paths.join(home, 'linked');
      yield* run(git, root, ['worktree', 'add', '-q', '-b', 'linked', linked]);
      yield* files.writeFileString(paths.join(linked, 'kept.txt'), 'one\ntwo\nthree\n');
      const registered = yield* roots.register({ path: linked, provenance });
      const seen = yield* Deferred.make<void>();
      const rows = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(registered.rootId), () => Deferred.succeed(seen, undefined)),
            2,
          ),
        ),
      );
      yield* Deferred.await(seen);
      yield* run(git, linked, ['add', 'kept.txt']);
      const [before, after] = yield* Fiber.join(rows);
      expect(before?.unwatched).toBe(false);
      expect(before?.entries.unstaged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
      expect(after?.entries.staged.entries.map((entry) => entry.path)).toEqual(['kept.txt']);
      expect(after?.entries.unstaged.entries).toEqual([]);
    }),
  );
  it.effect('a listing git refuses leaves the last row standing, marked stale', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const seen = yield* Deferred.make<void>();
      const rows = yield* Effect.forkChild(
        Stream.runCollect(
          Stream.take(
            Stream.tap(status.subscribe(rootId), () => Deferred.succeed(seen, undefined)),
            2,
          ),
        ),
      );
      yield* Deferred.await(seen);
      door.refuseListing();
      yield* status.mark(rootId);
      const collected = yield* Fiber.join(rows);
      const [before, after] = collected;
      expect(collected.map((row) => row.revision)).toEqual([1, 2]);
      expect(before?.stale).toBe(false);
      expect(after?.stale).toBe(true);
      expect(after?.revision).toBe(2);
      expect(after?.entries).toEqual(before?.entries);
      expect(after?.head).toBe(before?.head ?? null);
    }),
  );
  it.effect('one movement of a checkout held against two bases costs one tree reading', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId, door } = yield* fixture;
      const following = Effect.fnUntraced(function* (base: string) {
        const seen = yield* Deferred.make<void>();
        const rows = yield* Effect.forkChild(
          Stream.runCollect(
            Stream.take(
              Stream.tap(status.subscribe(rootId, base), () => Deferred.succeed(seen, undefined)),
              2,
            ),
          ),
        );
        yield* Deferred.await(seen);
        return rows;
      });
      const born = yield* following('HEAD~1');
      const based = yield* following('base');
      door.counts.readings = 0;
      yield* files.writeFileString(paths.join(root, 'typed.txt'), 'y\n');
      yield* status.mark(rootId);
      const [, afterBorn] = yield* Fiber.join(born);
      const [, afterBased] = yield* Fiber.join(based);
      expect(door.counts.readings).toBe(1);
      expect(afterBorn?.compare?.base).toBe('HEAD~1');
      expect(afterBased?.compare?.base).toBe('base');
      for (const row of [afterBorn, afterBased]) {
        expect(row?.entries.untracked.entries.map((entry) => entry.path)).toContain('typed.txt');
      }
    }),
  );
  it.effect('a reader that comes back while its watched tree stands still finds its rows and spends no git', () =>
    Effect.gen(function* () {
      const { status, rootId, door } = yield* fixture;
      const round = Effect.all(
        [Stream.runCollect(Stream.take(status.subscribe(rootId), 1)), Stream.runCollect(Stream.take(status.subscribe(rootId, 'base'), 1))],
        { concurrency: 2 },
      );
      const [[plain], [based]] = yield* round;
      const spent = door.counts.spawns;
      const [[plainAgain], [basedAgain]] = yield* round;
      const oneShot = yield* status.read(rootId, 'base');
      expect(door.counts.spawns).toBe(spent);
      expect(plainAgain).toEqual(plain);
      expect(basedAgain).toEqual(based);
      expect(based).toEqual(oneShot);
    }),
  );
  it.effect('a tree that moves while nobody holds its reading is read afresh for the reader that comes back', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId } = yield* fixture;
      yield* Stream.runCollect(Stream.take(status.subscribe(rootId), 1));
      const marked = yield* Deferred.make<void>();
      const detach = status.onMark(() => Effect.asVoid(Deferred.succeed(marked, undefined)));
      yield* files.writeFileString(paths.join(root, 'typed.txt'), 'y\n');
      yield* Deferred.await(marked);
      detach();
      const row = yield* status.read(rootId);
      expect(row.entries.untracked.entries.map((entry) => entry.path)).toContain('typed.txt');
    }),
  );
  it.effect('readings of many checkouts run at most three at once', () =>
    Effect.gen(function* () {
      const { files, paths, home, door, roots, status, rootId } = yield* fixture;
      const more = yield* Effect.forEach(
        [1, 2, 3],
        Effect.fnUntraced(function* (n) {
          const at = paths.join(home, `more-${n}`);
          yield* files.makeDirectory(at, { recursive: true });
          yield* run(door.faces, at, ['init', '-q', '-b', 'main']);
          return (yield* roots.register({ path: at, provenance })).rootId;
        }),
      );
      const held = yield* pause;
      door.holdEvery(held, 3);
      const readers = yield* Effect.forkChild(Effect.forEach([rootId, ...more], (id) => status.read(id), { concurrency: 'unbounded' }));
      yield* Deferred.await(held.arrived);
      const crowded = door.counts.running;
      yield* Deferred.succeed(held.gate, undefined);
      const rows = yield* Fiber.join(readers);
      expect(crowded).toBe(3);
      expect(door.counts.peak).toBe(3);
      expect(rows.length).toBe(4);
    }),
  );
  it.effect('marks reaching a checkout whose reading still waits for its turn are carried by that reading', () =>
    Effect.gen(function* () {
      const { files, paths, home, door, roots, status, rootId, root } = yield* fixture;
      const more = yield* Effect.forEach(
        [1, 2, 3],
        Effect.fnUntraced(function* (n) {
          const at = paths.join(home, `more-${n}`);
          yield* files.makeDirectory(at, { recursive: true });
          yield* run(door.faces, at, ['init', '-q', '-b', 'main']);
          return { at, rootId: (yield* roots.register({ path: at, provenance })).rootId };
        }),
      );
      const checkouts = [{ at: root, rootId }, ...more];
      const held = yield* pause;
      door.holdEvery(held, 3);
      const readers = yield* Effect.forkChild(Effect.forEach(checkouts, (one) => status.read(one.rootId), { concurrency: 'unbounded' }));
      yield* Deferred.await(held.arrived);
      const listed = (at: string) => door.commands.filter((args) => args.includes('--porcelain=v2') && args.includes(at)).length;
      const waiting = checkouts.find((one) => listed(one.at) === 0);
      if (waiting === undefined) return yield* Effect.die('every reading had started');
      yield* files.writeFileString(paths.join(waiting.at, 'queued.txt'), 'x\n');
      yield* status.mark(waiting.rootId);
      yield* status.mark(waiting.rootId);
      yield* Deferred.succeed(held.gate, undefined);
      const rows = yield* Fiber.join(readers);
      expect(listed(waiting.at)).toBe(1);
      expect(rows[checkouts.indexOf(waiting)]?.entries.untracked.entries.map((entry) => entry.path)).toContain('queued.txt');
    }),
  );
  it.effect('a mark naming more paths than one command line carries still answers a fresh row', () =>
    Effect.gen(function* () {
      const { files, paths, root, status, rootId } = yield* fixture;
      const stream = yield* status.follow(rootId, 'base');
      const initial = yield* Stream.runHead(stream);
      if (initial._tag === 'None') return yield* Effect.die('the initial checkout row was missing');
      yield* files.writeFileString(paths.join(root, 'wide.txt'), 'outside the named scopes\n');
      const next = yield* Effect.forkChild(Stream.runHead(stream.pipe(Stream.filter((row) => row.revision > initial.value.revision))));
      const named = Array.from({ length: 100 }, (_, n) => `deep/${'segment/'.repeat(24)}${n}.txt`);
      yield* status.mark(rootId, 'tree', named);
      const row = yield* Fiber.join(next);
      expect(row._tag === 'Some' && row.value.stale).toBe(false);
      expect(row._tag === 'Some' ? row.value.entries.untracked.entries.map((entry) => entry.path) : []).toEqual([
        'alone.txt',
        'fresh.txt',
        'wide.txt',
      ]);
    }),
  );
});
