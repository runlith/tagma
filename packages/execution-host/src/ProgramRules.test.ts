import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Deferred, Duration, Effect, Fiber, Queue, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { LimitProvenance, ProgramRuleCopy } from '@runlith/executions/protocol/command';
import type { ProcessWatchReading } from '@runlith/executions/protocol/stop';
import type { BoundRuleRecord } from './db/persisted';
import { makeProcessWatch } from './ProcessWatch';
import { type DefaultDeadline, makeProgramRules } from './ProgramRules';
import { makeProcessTables, makeProvenSet } from './ProvenSet';
import { Processes } from './ProcessReader';
import { LEADER, MINUTE, ROOT, World, climbAt, rule } from './testing/processWorld';

type DeadlineMove = { readonly atMs: number; readonly executionMs: number };

type Deadline = {
  revision: number;
  executionMs: number;
  origin: LimitProvenance;
  foregroundMs?: number | undefined;
  readonly moves: DeadlineMove[];
};

const deadlineOver = (standing: Deadline): DefaultDeadline => ({
  defaultMs: 10 * MINUTE,
  read: Effect.map(Clock.currentTimeMillis, (now) => ({
    revision: standing.revision,
    executionMs: standing.executionMs,
    origin: standing.origin,
    elapsedMs: now,
    foregroundMs: standing.foregroundMs,
  })),
  extend: (expected, executionMs) =>
    Effect.flatMap(Clock.currentTimeMillis, (atMs) =>
      Effect.sync(() => {
        if (expected !== standing.revision) return;
        standing.revision += 1;
        standing.executionMs = executionMs;
        standing.moves.push({ atMs, executionMs });
      }),
    ),
});

type Watched = {
  readonly at: (ms: number) => Effect.Effect<void>;
  readonly reading: Effect.Effect<ProcessWatchReading>;
};

type Link = {
  readonly persist?: (bound: ReadonlyArray<BoundRuleRecord>) => Effect.Effect<void>;
  readonly resumed?: ReadonlyArray<BoundRuleRecord>;
};

const watching = Effect.fnUntraced(function* (
  world: World,
  rules: readonly [ProgramRuleCopy, ...ProgramRuleCopy[]],
  deadline?: Deadline,
  link: Link = {},
): Effect.fn.Return<Watched, never, Scope.Scope> {
  const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, world.reader));
  const set = yield* makeProvenSet({ tables, leader: LEADER, birth: '600', work: undefined });
  const bound = yield* makeProgramRules({
    set,
    programs: { root: ROOT, rules },
    ports: {
      lookups: { isFile: (path) => world.files.has(path), realPath: (path) => path },
      kill: world.kill,
      first: 'interrupt',
      changed: Effect.void,
      persist: link.persist,
      deadline: deadline === undefined ? undefined : deadlineOver(deadline),
      climb: climbAt,
    },
    resumed: link.resumed,
  }).pipe(Effect.provideService(Processes, world.reader));
  const watch = yield* makeProcessWatch({ tables });
  yield* watch.hold(set);
  yield* watch.enforce(set, bound);
  return {
    at: Effect.fnUntraced(function* (ms) {
      const now = yield* Clock.currentTimeMillis;
      if (ms > now) yield* TestClock.adjust(Duration.millis(ms - now));
      yield* TestClock.adjust(0);
    }),
    reading: bound.reading(),
  };
});

const endedBy = (reading: ProcessWatchReading) =>
  reading.rulings.flatMap((ruling) => (ruling._tag === 'Ended' ? [[ruling.pid, ruling.rule.id, ruling.step] as const] : []));

it.effect('keeps a completed ruling when another process binding is being persisted', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'work'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['job']);
    const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, world.reader));
    const set = yield* makeProvenSet({ tables, leader: LEADER, birth: '600', work: undefined });
    const refresh = Effect.gen(function* () {
      yield* TestClock.adjust('1 millis');
      yield* set.grow(yield* tables.read());
      yield* set.refresh(
        (yield* set.due()).map(([pid]) => pid),
        yield* Clock.currentTimeMillis,
      );
    });
    const stopping = yield* Deferred.make<void>();
    const finishStop = yield* Deferred.make<void>();
    const persisting = yield* Deferred.make<void>();
    const finishPersist = yield* Deferred.make<void>();
    const changed = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
    const bound = yield* makeProgramRules({
      set,
      programs: { root: ROOT, rules: [rule('job', ['job'], 10)] },
      ports: {
        lookups: { isFile: (path) => world.files.has(path), realPath: (path) => path },
        kill: world.kill,
        first: 'interrupt',
        changed: Effect.asVoid(Queue.offer(changed, undefined)),
        climb: Effect.fnUntraced(function* (first, aims) {
          yield* Deferred.succeed(stopping, undefined);
          yield* Deferred.await(finishStop);
          return yield* climbAt(first, aims);
        }),
        persist: Effect.fnUntraced(function* (rows) {
          if (!rows.some((row) => row.pid === 102)) return;
          yield* Deferred.succeed(persisting, undefined);
          yield* Deferred.await(finishPersist);
        }),
      },
    }).pipe(Effect.provideService(Processes, world.reader));
    yield* refresh;
    yield* bound.round(0);
    yield* bound.round(10);
    yield* Deferred.await(stopping);
    yield* Queue.take(changed);
    world.spawn(102, LEADER, ['job']);
    yield* refresh;
    const round = yield* Effect.forkScoped(bound.round(11));
    yield* Deferred.await(persisting);
    yield* Deferred.succeed(finishStop, undefined);
    yield* Queue.take(changed);
    expect(endedBy(yield* bound.reading())).toEqual([[101, 'job', 'interrupt']]);
    yield* Deferred.succeed(finishPersist, undefined);
    yield* Fiber.join(round);
    expect(endedBy(yield* bound.reading())).toEqual([[101, 'job', 'interrupt']]);
  }),
);

it.effect(
  'a matched process and its subtree go down the ladder once its limit from the match runs out, and the rest of the command runs on',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.files.add(`${ROOT}/node_modules/typescript/bin/tsc`);
      world.files.add(`${ROOT}/node_modules/typescript/lib/worker.js`);
      world.spawn(LEADER, 1, ['sh', '-c', 'bun run check'], `${ROOT}/apps/api`, '/bin/sh');
      world.spawn(101, LEADER, ['bun', 'run', 'check'], `${ROOT}/apps/api`);
      world.spawn(102, 101, ['node', `${ROOT}/node_modules/typescript/bin/tsc`, '-p', '.'], `${ROOT}/apps/api`);
      world.spawn(103, 102, ['node', `${ROOT}/node_modules/typescript/lib/worker.js`], `${ROOT}/apps/api`);
      world.spawn(104, LEADER, ['node', `${ROOT}/node_modules/typescript/bin/tsc`, '-p', '.'], `${ROOT}/apps/web`);
      const api = rule('api', ['tsc'], MINUTE, 'apps/api');

      const [early, late] = yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [api]);
          yield* watched.at(MINUTE - 1);
          const early = [...world.signals];
          yield* watched.at(MINUTE);
          return [early, yield* watched.reading] as const;
        }),
      );

      expect(early).toEqual([]);
      expect(world.signalled(102)).toEqual(['interrupt']);
      expect(world.signalled(103)).toEqual(['interrupt']);
      expect(world.signalled(104)).toEqual([]);
      expect(world.signalled(101)).toEqual([]);
      expect(world.signalled(LEADER)).toEqual([]);
      expect(world.procs.has(101) && world.procs.has(LEADER) && world.procs.has(104)).toBe(true);
      expect(endedBy(late).sort()).toEqual([
        [102, 'api', 'interrupt'],
        [103, 'api', 'interrupt'],
      ]);
    }),
);

it.effect(
  'a shell is charged from the round it execs into a matched program, and a process that moves into a rule folder is matched there',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'sleep 1; bun test'], ROOT, '/bin/sh');
      world.spawn(105, 1, ['tsc'], `${ROOT}/other`);
      world.procs.get(105)!.parent = LEADER;
      const bunTest = rule('test', ['bun', 'test'], 20 * MINUTE);
      const api = rule('api', ['tsc'], MINUTE, 'apps/api');

      const signalled = yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [bunTest, api]);
          yield* watched.at(2_000);
          const shell = world.procs.get(LEADER)!;
          shell.args = ['bun', 'test'];
          shell.exe = '/usr/local/bin/bun';
          world.procs.get(105)!.folder = `${ROOT}/apps/api`;
          yield* watched.at(3_000);
          yield* watched.at(3_000 + MINUTE - 1);
          const before = world.signalled(105);
          yield* watched.at(3_000 + MINUTE);
          const tsc = world.signalled(105);
          yield* watched.at(3_000 + 20 * MINUTE - 1);
          const bunEarly = world.signalled(LEADER);
          yield* watched.at(3_000 + 20 * MINUTE);
          return { before, tsc, bunEarly, bun: world.signalled(LEADER) };
        }),
      );

      expect(signalled).toEqual({ before: [], tsc: ['interrupt'], bunEarly: [], bun: ['interrupt'] });
    }),
);

it.effect('a program rule binds neither a word found elsewhere in the arguments nor a file its program only reads', () =>
  Effect.gen(function* () {
    const world = new World();
    world.files.add(`${ROOT}/scripts/test.ts`);
    world.files.add(`${ROOT}/pytest.ini`);
    world.spawn(LEADER, 1, ['sh', '-c', 'work'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['git', 'add', 'docs/commit.md']);
    world.spawn(102, LEADER, ['bun', 'run', 'scripts/test.ts']);
    world.spawn(103, LEADER, ['cat', 'pytest.ini']);

    const reading = yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [
          rule('commit', ['git', 'commit'], 1_000),
          rule('test', ['bun', 'test'], 1_000),
          rule('pytest', ['pytest'], 1_000),
        ]);
        yield* watched.at(10_000);
        return yield* watched.reading;
      }),
    );

    expect(world.signals).toEqual([]);
    expect(reading.rulings).toEqual([]);
  }),
);

it.effect(
  "the last matching rule decides — a thread's rule after the project's — and a matched ancestor's limit ends a descendant with a longer one",
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'tsc; make'], ROOT, '/bin/sh');
      world.spawn(101, LEADER, ['tsc']);
      world.spawn(102, LEADER, ['make']);
      world.spawn(103, 102, ['cargo', 'test']);

      const reading = yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [
            rule('project-tsc', ['tsc'], MINUTE),
            rule('make', ['make'], 5 * MINUTE),
            rule('cargo', ['cargo', 'test'], 30 * MINUTE),
            rule('thread-tsc', ['tsc'], 10_000, undefined, 'thread-1'),
          ]);
          yield* watched.at(10_000);
          yield* watched.at(5 * MINUTE);
          return yield* watched.reading;
        }),
      );

      expect(endedBy(reading).sort()).toEqual([
        [101, 'thread-tsc', 'interrupt'],
        [102, 'make', 'interrupt'],
        [103, 'make', 'interrupt'],
      ]);
    }),
);

it.effect(
  'a proven member whose pid is reused is never signalled, and a member re-parented away from its matched ancestor is still ended with it',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'work'], ROOT, '/bin/sh');
      world.spawn(101, LEADER, ['sleep', '9']);
      world.spawn(102, LEADER, ['make']);
      world.spawn(103, 102, ['sh', '-c', 'sleep 100']);
      world.spawn(104, 103, ['sleep', '100']);

      yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [rule('sleep', ['sleep', '9'], 5_000), rule('make', ['make'], 5_000)]);
          yield* watched.at(1_000);
          world.procs.delete(101);
          world.procs.set(101, { pid: 101, parent: 1, birth: '90000', args: ['sleep', '9'], exe: '/usr/bin/sleep', folder: ROOT });
          world.exit(103);
          yield* watched.at(5_000);
        }),
      );

      expect(world.signalled(101)).toEqual([]);
      expect(world.signalled(102)).toEqual(['interrupt']);
      expect(world.signalled(104)).toEqual(['interrupt']);
    }),
);

it.effect('a process that survives the ladder is answered as survived with the steps it outlived', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'work'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['stubborn']).deaf = true;

    const reading = yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [rule('stubborn', ['stubborn'], 1_000)]);
        yield* watched.at(1_000);
        return yield* watched.reading;
      }),
    );

    expect(world.signalled(101)).toEqual(['interrupt', 'terminate', 'kill']);
    expect(reading.rulings.map((ruling) => ruling._tag)).toEqual(['Survived']);
  }),
);

it.effect('a matched process that exits still ends what it left behind at its own limit', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'make'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['make']);
    world.spawn(102, 101, ['cargo', 'test']);

    const reading = yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [rule('make', ['make'], 5 * MINUTE), rule('cargo', ['cargo', 'test'], 30 * MINUTE)]);
        yield* watched.at(MINUTE);
        world.exit(101);
        yield* watched.at(5 * MINUTE);
        return yield* watched.reading;
      }),
    );

    expect(world.signalled(102)).toEqual(['interrupt']);
    expect(endedBy(reading).find(([pid]) => pid === 102)).toEqual([102, 'make', 'interrupt']);
  }),
);

it.effect(
  'a process whose arguments cannot be read is named and bound by nothing, while a matched one that turns unreadable keeps its clock',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'work'], ROOT, '/bin/sh');
      world.spawn(101, LEADER, ['tsc']).unreadable = true;
      world.spawn(102, LEADER, ['tsc']);

      const reading = yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [rule('tsc', ['tsc'], 5_000)]);
          yield* watched.at(1_000);
          world.procs.get(102)!.unreadable = true;
          yield* watched.at(5_000);
          return yield* watched.reading;
        }),
      );

      expect(world.signalled(101)).toEqual([]);
      expect(world.signalled(102)).toEqual(['interrupt']);
      expect(reading.rulings.map((ruling) => [ruling._tag, ruling.pid]).sort()).toEqual([
        ['Ended', 102],
        ['Unread', 101],
      ]);
    }),
);

it.effect('a rule outside the copy a command was admitted with binds nothing in it', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'bun test && git commit -m x'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['git', 'commit', '-m', 'x']);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [rule('test', ['bun', 'test'], 20 * MINUTE)]);
        yield* watched.at(MINUTE);
      }),
    );

    expect(world.signals).toEqual([]);
  }),
);

it.effect('bun test && git commit: the test keeps its own time while the commit is ended at its own', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'bun test && git commit -m x'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['bun', 'test']);

    const signalled = yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [rule('test', ['bun', 'test'], 20 * MINUTE), rule('commit', ['git', 'commit'], 30_000)]);
        yield* watched.at(5 * MINUTE);
        world.exit(101);
        world.spawn(102, LEADER, ['git', 'commit', '-m', 'x']);
        yield* watched.at(5 * MINUTE + 1_000 + 30_000 - 1);
        const commit = world.signalled(102);
        yield* watched.at(5 * MINUTE + 1_000 + 30_000);
        return { test: world.signalled(101), before: commit, commit: world.signalled(102), shell: world.signalled(LEADER) };
      }),
    );

    expect(signalled).toEqual({ test: [], before: [], commit: ['interrupt'], shell: [] });
  }),
);

it.effect('a call on the default is extended when a covered process is first matched, and held there past the default', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['zsh', '-c', 'cd x && bun test'], `${ROOT}/x`, '/bin/zsh');
    world.spawn(101, LEADER, ['bun', 'test'], `${ROOT}/x`);
    world.spawn(102, 101, ['bun', 'worker'], `${ROOT}/x`);
    const deadline: Deadline = { revision: 0, executionMs: 10 * MINUTE, origin: 'default', moves: [] };

    const early = yield* Effect.scoped(
      Effect.gen(function* () {
        const watched = yield* watching(world, [rule('test', ['bun', 'test'], 20 * MINUTE)], deadline);
        yield* watched.at(0);
        const early = [...deadline.moves];
        yield* watched.at(12 * MINUTE);
        return early;
      }),
    );

    expect(early).toEqual([{ atMs: 0, executionMs: 20 * MINUTE }]);
    expect(deadline.moves).toEqual([{ atMs: 0, executionMs: 20 * MINUTE }]);
    expect(world.signals).toEqual([]);
  }),
);

it.effect(
  'a call its caller waits on in the foreground is extended no further than its foreground bound, and fully once that bound is released',
  () =>
    Effect.gen(function* () {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'bun test'], ROOT, '/bin/sh');
      world.spawn(101, LEADER, ['bun', 'test']);
      const deadline: Deadline = { revision: 0, executionMs: 10 * MINUTE, origin: 'default', foregroundMs: 15 * MINUTE, moves: [] };

      const held = yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [rule('test', ['bun', 'test'], 20 * MINUTE)], deadline);
          yield* watched.at(MINUTE);
          const held = [...deadline.moves];
          deadline.foregroundMs = undefined;
          yield* watched.at(3 * MINUTE);
          return held;
        }),
      );

      expect(held.map((move) => move.executionMs)).toEqual([15 * MINUTE]);
      expect(deadline.moves.map((move) => move.executionMs)).toEqual([15 * MINUTE, 20 * MINUTE]);
    }),
);

it.effect(
  "a covered process that exits early brings the call back to the default's instant, or to the round of its exit once that has passed",
  () =>
    Effect.gen(function* () {
      const before = new World();
      before.spawn(LEADER, 1, ['sh', '-c', 'bun test; sleep 1000'], ROOT, '/bin/sh');
      before.spawn(101, LEADER, ['bun', 'test']);
      const early: Deadline = { revision: 0, executionMs: 10 * MINUTE, origin: 'default', moves: [] };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(before, [rule('test', ['bun', 'test'], 20 * MINUTE)], early);
          yield* watched.at(2 * MINUTE);
          before.exit(101);
          yield* watched.at(3 * MINUTE);
        }),
      );
      expect(early.moves.map((move) => move.executionMs)).toEqual([20 * MINUTE, 10 * MINUTE]);

      const after = new World();
      after.spawn(LEADER, 1, ['sh', '-c', 'bun test; sleep 1000'], ROOT, '/bin/sh');
      after.spawn(101, LEADER, ['bun', 'test']);
      const late: Deadline = { revision: 0, executionMs: 10 * MINUTE, origin: 'default', moves: [] };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(after, [rule('test', ['bun', 'test'], 20 * MINUTE)], late);
          yield* watched.at(12 * MINUTE + 500);
          after.exit(101);
          yield* watched.at(14 * MINUTE);
        }),
      );
      const last = late.moves.at(-1)!;
      expect(late.moves).toHaveLength(2);
      expect(last.executionMs).toBeGreaterThan(12 * MINUTE + 500);
      expect(last.executionMs).toBeLessThanOrEqual(12 * MINUTE + 500 + 1_000);
    }),
);

it.effect("a call whose time is its caller's or a whole-call rule's is never extended", () =>
  Effect.gen(function* () {
    for (const origin of ['caller', 'rule'] as const) {
      const world = new World();
      world.spawn(LEADER, 1, ['sh', '-c', 'bun test'], ROOT, '/bin/sh');
      world.spawn(101, LEADER, ['bun', 'test']);
      const deadline: Deadline = { revision: 1, executionMs: 10 * MINUTE, origin, moves: [] };
      yield* Effect.scoped(
        Effect.gen(function* () {
          const watched = yield* watching(world, [rule('test', ['bun', 'test'], 20 * MINUTE)], deadline);
          yield* watched.at(MINUTE);
        }),
      );
      expect(deadline.moves).toEqual([]);
    }
  }),
);

it.effect('a rule bound before a restart is due at the instant it was written, however long the restart took', () =>
  Effect.gen(function* () {
    const world = new World();
    world.spawn(LEADER, 1, ['sh', '-c', 'bun run check'], ROOT, '/bin/sh');
    world.spawn(101, LEADER, ['node', `${ROOT}/node_modules/typescript/bin/tsc`, '-p', '.'], ROOT);
    world.files.add(`${ROOT}/node_modules/typescript/bin/tsc`);
    const tsc = rule('tsc', ['tsc'], MINUTE);
    let written: ReadonlyArray<BoundRuleRecord> = [];

    const reopened = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* watching(world, [tsc], undefined, {
              persist: (bound) => Effect.sync(() => void (written = bound)),
            });
            yield* first.at(10_000);
          }),
        );
        yield* TestClock.adjust(Duration.millis(20_000));
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const second = yield* watching(world, [tsc], undefined, { resumed: written });
            yield* second.at(MINUTE - 1);
            const early = world.signalled(101);
            yield* second.at(MINUTE + 5_000);
            return { early, late: world.signalled(101) };
          }),
        );
      }),
    );

    expect(written.map((one) => one.pid)).toEqual([101]);
    expect(reopened.early).toEqual([]);
    expect(reopened.late.length).toBeGreaterThan(0);
  }),
);
