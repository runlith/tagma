import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Stream } from 'effect';
import { Git } from '@runlith/git/Git';
import type { ChangeCommit } from '../../../change-record/contract/wire/threadChanges.js';
import { workspaceChange } from '../../../change-record/store/tables.js';
import { PROJECT, MINE, BORN, GROWN, run, edited, fixture, layers, only, entriesOf, committed } from './threadFilesWorld.js';

layer(layers, { excludeTestServices: true })('thread commits', (it) => {
  it.effect('the frame lists the commits stamped on the thread that HEAD reaches, newest first, cut to the limit', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const first = yield* committed(world, 'kept.txt', BORN, GROWN, 'grow kept');
      const second = yield* committed(world, 'other.txt', '', 'other\n', 'add other');

      const whole = yield* world.list();
      expect(whole.commits.map((commit) => [commit.sha, commit.subject, commit.author, commit.files])).toEqual([
        [second, 'add other', 'git', 1],
        [first, 'grow kept', 'git', 1],
      ]);
      expect(whole.moreCommits).toBe(false);
      expect(whole.checkouts.map((one) => one.checkout)).toEqual([world.rootId]);
      expect(whole.checkouts.map((one) => one.state.kind)).not.toContain('stale');

      const cut = yield* world.list(MINE, 1);
      expect(cut.commits.map((commit) => commit.sha)).toEqual([second]);
      expect(cut.moreCommits).toBe(true);
    }),
  );

  it.effect('a commit amend took off the branch is not listed, and a sha git does not hold is not listed', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const kept = yield* committed(world, 'kept.txt', BORN, GROWN, 'grow kept');
      yield* committed(world, 'other.txt', '', 'other\n', 'add other');
      yield* run(world.git, world.root, ['commit', '-q', '--amend', '-m', 'add other, amended']);
      yield* world.store.db.insert(workspaceChange).values({
        projectId: PROJECT,
        holderProjectId: PROJECT,
        holder: MINE,
        checkout: world.rootId,
        path: 'lost.txt',
        state: 'committed',
        origin: 'edit',
        afterHash: 'lost',
        at: new Date(yield* Clock.currentTimeMillis),
        commit: 'f'.repeat(40),
        committedAt: new Date((yield* Clock.currentTimeMillis) + 60_000),
      });

      const listed = yield* world.list();
      expect(listed.commits.map((commit) => commit.sha)).toEqual([kept]);
      expect(listed.moreCommits).toBe(false);
      expect(listed.checkouts.map((one) => one.checkout)).toEqual([world.rootId]);
      expect(listed.checkouts.map((one) => one.state.kind)).not.toContain('stale');
    }),
  );

  it.effect('a held frame drops a commit once HEAD stops reaching it', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const pull = yield* Stream.toPull(world.changes.subscribe(PROJECT, MINE, world.rootId, 30));
      let commits: readonly ChangeCommit[] = [];
      const until = Effect.fnUntraced(function* (done: (shown: readonly ChangeCommit[]) => boolean) {
        for (;;) {
          for (const frame of yield* pull) {
            if (frame.kind === 'whole') commits = frame.commits;
            else if (frame.commits !== undefined) commits = frame.commits.list;
          }
          if (done(commits)) return commits;
        }
      });
      const grown = yield* committed(world, 'kept.txt', BORN, GROWN, 'grow kept');
      yield* world.checkouts.mark(world.rootId);
      expect((yield* until((shown) => shown.length > 0)).map((commit) => commit.sha)).toEqual([grown]);

      yield* run(world.git, world.root, ['commit', '-q', '--amend', '-m', 'grow kept, amended']);
      yield* world.checkouts.mark(world.rootId);
      expect(yield* until((shown) => shown.length === 0)).toEqual([]);
    }),
  );

  it.effect('a HEAD that moves while the first judgment reads its inputs is judged again before the checkout reads current', () =>
    Effect.gen(function* () {
      const real = yield* Git;
      const moved = yield* Deferred.make<void>();
      const adopted = yield* Deferred.make<void>();
      let dir: string | undefined;
      let armed = true;
      const gated: Git['Service'] = {
        objects: real.objects,
        run: (args, options) => {
          if (dir === undefined) return real.run(args, options);
          if (args.includes('-C') && args.includes('rev-parse') && args.at(-1) === 'HEAD' && !Deferred.isDoneUnsafe(moved))
            return Effect.andThen(Deferred.await(moved), real.run(args, options));
          if (!armed || !args.includes('status') || !args.includes('--untracked-files=no')) return real.run(args, options);
          armed = false;
          const cwd = dir;
          return Effect.tap(real.run(args, options), () =>
            Effect.andThen(
              Effect.andThen(run(real, cwd, ['commit', '-q', '-am', 'moved']), Deferred.succeed(moved, undefined)),
              Deferred.await(adopted),
            ),
          );
        },
      };
      const world = yield* Effect.provideService(fixture, Git, gated);
      const deaf = world.holdings.stated((checkout) =>
        Effect.flatMap(Effect.orDie(world.holdings.meta(checkout)), (meta) =>
          meta.head !== null && meta.head !== born ? Deferred.succeed(adopted, undefined) : Effect.void,
        ),
      );
      yield* Effect.addFinalizer(() => Effect.sync(deaf));
      const born = yield* run(real, world.root, ['rev-parse', 'HEAD']);
      const at = world.paths.join(world.root, 'kept.txt');
      yield* world.files.writeFileString(at, GROWN);
      dir = world.root;
      yield* edited(world.mine, at, BORN, GROWN);
      yield* Deferred.await(adopted);

      const listed = yield* world.list();
      expect(listed.checkouts.map((one) => [one.checkout, one.state.kind, one.entries])).toEqual([[world.rootId, 'current', []]]);
    }),
  );

  it.effect('a typed path that stands in neither HEAD nor the working tree leaves the list, and reading it writes nothing', () =>
    Effect.gen(function* () {
      const world = yield* fixture;
      const loose = world.paths.join(world.root, 'loose.txt');
      yield* world.files.writeFileString(loose, BORN);
      yield* edited(world.mine, loose, '', BORN);
      expect(only(yield* world.list()).path).toBe('loose.txt');

      yield* world.files.remove(loose);
      yield* world.holdings.moved(world.rootId, 'all');
      expect(entriesOf(yield* world.list())).toEqual([]);

      const rows = yield* world.store.db.select({ state: workspaceChange.state }).from(workspaceChange);
      expect(rows.map((row) => row.state)).toEqual(['held']);
    }),
  );
});
