import { expect } from 'bun:test';
import { eq } from 'drizzle-orm';
import { worktreeMerge } from '../store/tables.js';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Queue } from 'effect';
import { Git, gitVerb } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { makeMergeChecks } from './mergeChecks.js';
import { fixtureMigrations } from '../../composition/testing/migrations.js';
import { Capacity, heavyPool, serverCapacity } from '../../platform/contract/service/capacity.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { seededStoreLayer } from '../../platform/store/open.js';
import { sharedPool } from '@runlith/sqlite-process/testing/pool';
import { unitsLayer } from '../../platform/store/units.js';
import { MERGE_CHECKS, pools } from '../capacity.js';
import { CheckPreparation } from '../contract/service/mergeChecks.js';
import { makeFinishingGates } from '../retirement/gates.js';

const run = (cwd: string, args: readonly string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(new Error(`git ${args.join(' ')}: ${answer.stderr}`)),
    ),
  );

const commit = Effect.fnUntraced(function* (dir: string, text: string, message: string) {
  yield* (yield* FileSystem.FileSystem).writeFileString(join(dir, 'f.txt'), text);
  yield* run(dir, ['commit', '-q', '-am', message]);
  return yield* run(dir, ['rev-parse', 'HEAD']);
});

const diverged = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const dir = yield* files.realPath(yield* files.makeTempDirectoryScoped({ prefix: 'merge-checks-' }));
  yield* run(dir, ['init', '-q', '-b', 'main']);
  yield* run(dir, ['config', 'user.email', 'check@test']);
  yield* run(dir, ['config', 'user.name', 'check']);
  yield* files.writeFileString(join(dir, 'f.txt'), 'a\nb\nc\n');
  yield* run(dir, ['add', 'f.txt']);
  yield* run(dir, ['commit', '-q', '-m', 'base']);
  yield* run(dir, ['checkout', '-q', '-b', 'side']);
  const tip = yield* commit(dir, 'a\nB\nc\n', 'side');
  yield* run(dir, ['checkout', '-q', 'main']);
  const base = yield* commit(dir, 'a\nX\nc\n', 'main');
  return { dir, base, tip };
});

const counted = Effect.gen(function* () {
  const liveGit = yield* Git;
  const merges = { count: 0 };
  const service: Git['Service'] = {
    run: (args, options) => {
      if (gitVerb(args) === 'merge-tree') merges.count += 1;
      return liveGit.run(args, options);
    },
    objects: liveGit.objects,
  };
  return { merges, service };
});

const storage = unitsLayer(MachineUnits, MachineStore).pipe(
  Layer.provideMerge(
    Layer.unwrap(Effect.map(sharedPool, (pool) => seededStoreLayer(MachineStore, fixtureMigrations, { durable: false }, pool))),
  ),
);
const machine = { parallelism: 2, memoryBytes: 8 * 1024 ** 3 };
const capacity = Layer.succeed(Capacity, serverCapacity([heavyPool(machine), ...pools(machine)]));

layer(Layer.mergeAll(BunFileSystem.layer, liveGitLayer, storage, capacity), { excludeTestServices: true })('merge checks', (it) => {
  it.effect('a pair shares one merge until the merge configuration changes', () =>
    Effect.gen(function* () {
      const { dir, base, tip } = yield* diverged;
      const { merges, service } = yield* counted;
      const files = yield* FileSystem.FileSystem;
      const included = join(dir, '.git', 'merge-config');
      yield* files.writeFileString(included, '');
      yield* run(dir, ['config', 'include.path', 'merge-config']);
      const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, service));
      const gates = makeFinishingGates();
      const [one, two] = yield* gates.hold(
        { kind: 'checkout', path: dir },
        Effect.all([checks.check(dir, base, tip), checks.check(dir, base, tip)], { concurrency: 2 }),
      );
      const again = yield* checks.check(dir, base, tip);
      expect([one.conflicts, two.conflicts, again.conflicts]).toEqual([['f.txt'], ['f.txt'], ['f.txt']]);
      expect(merges.count).toBe(1);
      yield* files.writeFileString(included, '[merge]\nrenames = false\n');
      expect((yield* checks.last(dir, tip, base)).fact.state).toBe('previous');
      expect([...(yield* checks.saved([dir])).values()][0]?.fact.state).toBe('previous');
      expect((yield* checks.standing(dir, base, tip, true)).fact.state).toBe('queued');
      expect((yield* checks.check(dir, base, tip)).conflicts).toEqual(['f.txt']);
      expect(merges.count).toBe(2);
    }),
  );

  it.effect('forgetting a checkout stops its check, and whoever waited on it is refused rather than cut', () =>
    Effect.gen(function* () {
      const { dir, base, tip } = yield* diverged;
      const liveGit = yield* Git;
      const started = yield* Deferred.make<void>();
      const service: Git['Service'] = {
        run: (args, options) =>
          gitVerb(args) === 'merge-tree' ? Effect.andThen(Deferred.succeed(started, undefined), Effect.never) : liveGit.run(args, options),
        objects: liveGit.objects,
      };
      const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, service));
      const waiting = yield* Effect.forkScoped(Effect.flip(checks.check(dir, base, tip)));
      yield* Deferred.await(started);
      yield* checks.forget(dir);
      expect((yield* Fiber.join(waiting).pipe(Effect.timeout('5 seconds')))._tag).toBe('GitUnreadable');
      const preparing = yield* Deferred.make<void>();
      const resume = yield* Deferred.make<void>();
      const preparation = CheckPreparation.of({
        revision: 'preflight',
        behind: () => Effect.andThen(Deferred.succeed(preparing, undefined), Effect.as(Deferred.await(resume), false)),
        prepare: (_dir, _base, head) => Effect.succeed(head),
      });
      const preflight = yield* makeMergeChecks.pipe(
        Effect.provideService(Git, service),
        Effect.provideService(CheckPreparation, preparation),
      );
      const late = yield* Effect.forkScoped(Effect.flip(preflight.check(dir, base, tip)));
      yield* Deferred.await(preparing);
      yield* preflight.forget(dir);
      yield* Deferred.succeed(resume, undefined);
      expect((yield* Fiber.join(late).pipe(Effect.timeout('5 seconds')))._tag).toBe('GitUnreadable');
      expect((yield* preflight.last(dir, tip, base)).fact.state).toBe('untaken');
    }),
  );

  it.effect('a verdict checked from the git directory survives restart and a changed base, and forget removes it durably', () =>
    Effect.gen(function* () {
      const { dir: checkout, base, tip } = yield* diverged;
      const dir = join(checkout, '.git');
      const { merges, service } = yield* counted;
      const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, service));
      const landed = yield* Deferred.make<string>();
      checks.onTaken((path) => Deferred.doneUnsafe(landed, Exit.succeed(path)));
      expect((yield* checks.standing(dir, base, tip, false)).fact.state).toBe('untaken');
      expect(merges.count).toBe(0);
      expect((yield* checks.standing(dir, base, tip, true)).fact.state).toBe('queued');
      expect(yield* Deferred.await(landed).pipe(Effect.timeout('10 seconds'))).toBe(dir);
      expect(yield* checks.standing(dir, base, tip, false)).toMatchObject({
        check: 'conflicts',
        held: false,
        fact: { state: 'current', head: tip, base },
      });
      expect(merges.count).toBe(1);
      const saved = yield* checks.last(dir, tip, base);
      const offline: Git['Service'] = { run: () => Effect.die('reading a saved verdict must not run git') };
      const restored = yield* makeMergeChecks.pipe(Effect.provideService(Git, offline));
      expect(yield* restored.last(dir, tip, 'next-base')).toEqual({ ...saved, fact: { ...saved.fact, state: 'previous' } });
      expect(yield* restored.standing(dir, 'next-base', tip, true)).toEqual({ ...saved, fact: { ...saved.fact, state: 'previous' } });
      expect((yield* restored.last(dir, 'next-head', 'next-base')).fact).toEqual({ ...saved.fact, state: 'previous' });
      expect([...(yield* restored.saved([dir, 'unseen'])).keys()]).toEqual([dir]);
      const { db } = yield* MachineStore;
      yield* db
        .update(worktreeMerge)
        .set({ fingerprint: 'a'.repeat(64) })
        .where(eq(worktreeMerge.dir, dir));
      const legacy = yield* makeMergeChecks.pipe(Effect.provideService(Git, offline));
      expect((yield* legacy.last(dir, tip, base)).fact.state).toBe('previous');
      expect((yield* legacy.standing(dir, base, tip, true)).fact.state).toBe('previous');
      const copied = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      const units = yield* MachineUnits;
      const slow = MachineUnits.of({
        write: (operation, work) => units.write(operation, work),
        markReadOnly: (work) => units.markReadOnly(work),
        markWrite: (work) => units.markWrite(work),
        read: (work, options) =>
          units.read(work, options).pipe(
            Effect.tap(() => Deferred.succeed(copied, undefined)),
            Effect.tap(() => Deferred.await(released)),
          ),
      });
      const restoring = yield* makeMergeChecks.pipe(Effect.provideService(Git, offline), Effect.provideService(MachineUnits, slow));
      const late = yield* Effect.forkScoped(restoring.last(dir, tip, base));
      yield* Deferred.await(copied);
      yield* restoring.forget(dir);
      yield* Deferred.succeed(released, undefined);
      expect((yield* Fiber.join(late)).fact.state).toBe('untaken');
      expect((yield* restoring.last(dir, tip, base)).fact.state).toBe('untaken');
      yield* restored.forget(dir);
      const reopened = yield* makeMergeChecks.pipe(Effect.provideService(Git, offline));
      expect((yield* reopened.last(dir, tip, base)).fact.state).toBe('untaken');
    }),
  );

  it.effect('distinct merge checks share the machine lane and expose waiting work without starting another merge', () =>
    Effect.gen(function* () {
      const entered = yield* Queue.unbounded<string>();
      const released = yield* Queue.unbounded<void>();
      const base = 'a'.repeat(40);
      const tip = 'b'.repeat(40);
      const tree = 'c'.repeat(40);
      let active = 0;
      let peak = 0;
      const answer = (stdout: string, status = 0) => ({ status, stdout, stderr: '', overflow: false, messageOverflow: false });
      const git: Git['Service'] = {
        run: (args) => {
          const verb = gitVerb(args);
          if (verb === 'version') return Effect.succeed(answer('git version test'));
          if (verb === 'config') return Effect.succeed(answer('', args.includes('--list') ? 0 : 1));
          if (verb === 'log') return Effect.succeed(answer(`${tree}\0\0author\0a@test\0${1700000000} +0000\0base`));
          if (verb === 'rev-parse')
            return Effect.succeed(
              answer(
                args.includes('--is-bare-repository') ? 'false\n\n/repo/.git\n/repo/.git\n/repo\n' : '/repo/.git\n/repo/.git/objects\n',
              ),
            );
          if (verb !== 'merge-tree') return Effect.die(`unexpected git ${args.join(' ')}`);
          return Effect.acquireUseRelease(
            Effect.sync(() => {
              active += 1;
              peak = Math.max(peak, active);
            }),
            () =>
              Effect.andThen(
                Queue.offer(entered, args.at(-1) ?? ''),
                Effect.andThen(Queue.take(released), Effect.succeed(answer(`${tree}\0`))),
              ),
            () =>
              Effect.sync(() => {
                active -= 1;
              }),
          );
        },
      };
      const preparation = CheckPreparation.of({
        revision: 'test-format',
        behind: () => Effect.succeed(true),
        prepare: (_dir, _base, head) => Effect.succeed(head),
      });
      const checks = yield* makeMergeChecks.pipe(Effect.provideService(Git, git), Effect.provideService(CheckPreparation, preparation));
      expect(yield* checks.standing('/lane-a', base, tip, true)).toMatchObject({ check: 'format-behind', fact: { state: 'queued' } });
      yield* Queue.take(entered);
      expect((yield* checks.standing('/lane-b', base, tip, true)).fact.state).toBe('queued');
      expect((yield* checks.standing('/lane-c', base, tip, true)).fact.state).toBe('queued');
      const capacity = yield* Capacity;
      yield* Effect.yieldNow;
      expect(capacity.standing().find((one) => one.pool === MERGE_CHECKS)?.queued).toBe(2);
      yield* Queue.offerAll(released, [undefined, undefined, undefined]);
      const results = yield* Effect.forEach(['/lane-a', '/lane-b', '/lane-c'], (dir) => checks.check(dir, base, tip), { concurrency: 3 });
      expect(results.map((one) => one.tree)).toEqual([tree, tree, tree]);
      expect(peak).toBe(1);
    }),
  );
});
