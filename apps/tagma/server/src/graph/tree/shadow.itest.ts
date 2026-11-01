import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Context, Deferred, Effect, Fiber, FileSystem, Layer } from 'effect';
import { ownGitLayer, runGit } from '../../platform/git/ownGit.js';
import { ShadowGit } from './shadow.js';
import { NO_SIDE } from '../contract/service/exchange.js';

const platform = Layer.merge(BunFileSystem.layer, BunPath.layer);
const spawning = BunChildProcessSpawner.layer.pipe(Layer.provide(platform));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(spawning)));

class Template extends Context.Service<Template, string>()('testing/ShadowTemplate') {}

const template = Layer.effect(
  Template,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: 'shadow-template-' });
    const gitDir = join(root, 'graph.git');
    yield* ShadowGit.open(gitDir, yield* Git, NO_SIDE);
    return gitDir;
  }),
).pipe(Layer.provideMerge(Layer.merge(platform, git)));

const world = Effect.fnUntraced(function* (store = 'graph.git') {
  const fs = yield* FileSystem.FileSystem;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: 'shadow-git-' });
  const gitDir = join(base, store);
  const tree = join(base, 'trees', 'main');
  yield* fs.copy(yield* Template, gitDir, { overwrite: true });
  const shadow = yield* ShadowGit.open(gitDir, yield* Git, NO_SIDE);
  yield* shadow.attach(tree, 'main');
  return { base, gitDir, tree, shadow };
});

const block = (tree: string, name: string, body: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.writeFileString(join(tree, `${name}.md`), body));

layer(template, { excludeTestServices: true })('shadow git', (it) => {
  for (const kind of ['in-place', 'bare'] as const) {
    it.effect(`cancelling the ${kind} opening leaves a repository the next opening can write`, () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const git = yield* Git;
        const base = yield* fs.makeTempDirectoryScoped({ prefix: 'shadow-interrupted-' });
        const tree = join(base, 'tree');
        const gitDir = kind === 'bare' ? join(base, 'graph.git') : join(tree, '.git');
        const entered = yield* Deferred.make<void>();
        const released = yield* Deferred.make<void>();
        const pausing = Git.of({
          ...git,
          run: Effect.fn('testing.interruptedGitInit')(function* (args, options) {
            if (args.includes('init')) {
              yield* fs.makeDirectory(gitDir, { recursive: true });
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(released);
            }
            return yield* git.run(args, options);
          }),
        });
        const open = (given: Git['Service']) =>
          kind === 'bare' ? ShadowGit.open(gitDir, given, NO_SIDE) : ShadowGit.openInPlace(tree, given);
        const opening = yield* Effect.forkScoped(open(pausing));
        yield* Deferred.await(entered);
        yield* Effect.sync(() => opening.interruptUnsafe());
        yield* Effect.yieldNow;
        yield* Deferred.succeed(released, undefined);
        yield* Fiber.await(opening);
        const reopened = yield* open(git);
        if (kind === 'bare') yield* reopened.attach(tree, 'main');
        yield* fs.writeFileString(join(tree, 'truth.md'), 'kept after interruption');
        expect(yield* reopened.commitAct(tree, 'write after interruption')).toBeString();
        expect((yield* reopened.log(tree)).at(0)?.message).toBe('write after interruption');
      }),
    );
  }

  it.effect('history records Tagma-signed acts newest first, while an unchanged act leaves no commit', () =>
    Effect.gen(function* () {
      const { tree, shadow } = yield* world();
      yield* block(tree, 'doctrine', 'the original');
      const born = yield* shadow.commitAct(tree, 'create doctrine');
      expect(born).toBeString();
      expect(yield* shadow.commitAct(tree, 'nothing happened')).toBeNull();
      yield* block(tree, 'doctrine', 'the amended');
      const amended = yield* shadow.commitAct(tree, 'edit doctrine');
      const acts = yield* shadow.log(tree, 'doctrine.md');
      expect([amended, born]).toEqual(acts.map((act) => act.commit));
      expect(acts.map((act) => [act.author, act.message])).toEqual([
        ['Tagma', 'edit doctrine'],
        ['Tagma', 'create doctrine'],
      ]);
      expect(yield* shadow.run('identity', ['-C', tree, 'log', '-1', '--format=%an <%ae>|%cn <%ce>'])).toBe(
        'Tagma <agent@tagma.dev>|Tagma <agent@tagma.dev>',
      );
    }),
  );

  it.effect('different files merge without losing either branch write', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, tree, shadow } = yield* world();
      yield* block(tree, 'alpha', 'main side');
      yield* shadow.commitAct(tree, 'create alpha');
      yield* shadow.branch('feature', 'main');
      const other = join(base, 'feature');
      yield* shadow.attach(other, 'feature');
      yield* block(other, 'beta', 'feature side');
      yield* shadow.commitAct(other, 'create beta');
      yield* block(tree, 'alpha', 'main side, edited');
      yield* shadow.commitAct(tree, 'edit alpha');
      const merged = yield* shadow.merge(tree, 'feature', 'merge feature');
      expect(merged.conflicts).toEqual([]);
      expect(merged.merged).toBeString();
      expect([yield* fs.readFileString(join(tree, 'alpha.md')), yield* fs.readFileString(join(tree, 'beta.md'))]).toEqual([
        'main side, edited',
        'feature side',
      ]);
    }),
  );

  it.effect(
    'a conflicting quoted path in a shadow at a newline address reads its rival side and a resolution concludes the real merge',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { base, tree, shadow } = yield* world('graph\nstore.git');
        const name = 'хорошо\nзакон';
        yield* block(tree, name, 'the original');
        yield* shadow.commitAct(tree, 'create the block');
        yield* shadow.branch('rival', 'main');
        const other = join(base, 'rival');
        yield* shadow.attach(other, 'rival');
        yield* block(other, name, 'the rival truth');
        yield* shadow.commitAct(other, 'edit on rival');
        yield* block(tree, name, 'the main truth');
        yield* shadow.commitAct(tree, 'edit on main');
        const merged = yield* shadow.merge(tree, 'rival', 'merge rival');
        expect(merged).toEqual({ merged: null, conflicts: [`${name}.md`] });
        expect(yield* shadow.mergeInProgress(tree)).toBe(true);
        expect((yield* shadow.stagedSides(tree, `${name}.md`)).get(3)).toBe('the rival truth');
        yield* block(tree, name, 'the merged truth');
        expect(yield* shadow.concludeMerge(tree)).toBeString();
        expect(yield* shadow.run('identity', ['-C', tree, 'log', '-1', '--format=%ae|%ce'])).toBe('agent@tagma.dev|agent@tagma.dev');
        expect(yield* fs.readFileString(join(tree, `${name}.md`))).toBe('the merged truth');
        expect(yield* shadow.mergeInProgress(tree)).toBe(false);
      }),
  );

  it.effect('a branch travels through a newline address with its files and history and remains writable', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, tree, shadow } = yield* world();
      yield* block(tree, 'doctrine', 'written at the old address');
      yield* shadow.commitAct(tree, 'create doctrine');
      const odd = join(base, 'one\ntwo');
      yield* shadow.attach(odd, 'main');
      const moved = join(base, 'moved');
      yield* shadow.attach(moved, 'main');
      expect([yield* fs.exists(tree), yield* fs.exists(odd)]).toEqual([false, false]);
      expect(yield* fs.readFileString(join(moved, 'doctrine.md'))).toBe('written at the old address');
      expect((yield* shadow.log(moved)).map((act) => act.message).slice(0, 1)).toEqual(['create doctrine']);
      yield* block(moved, 'doctrine', 'edited at the new address');
      expect(yield* shadow.commitAct(moved, 'edit doctrine')).toBeString();
    }),
  );

  it.effect('an ancestor branch still produces a Tagma-signed merge commit with both parents', () =>
    Effect.gen(function* () {
      const { base, tree, shadow } = yield* world();
      const head = yield* shadow.run('head', ['-C', tree, 'rev-parse', 'HEAD']);
      yield* shadow.branch('feature', 'main');
      const other = join(base, 'feature');
      yield* shadow.attach(other, 'feature');
      yield* block(other, 'beta', 'feature work');
      const feature = yield* shadow.commitAct(other, 'create beta');
      const merged = yield* shadow.merge(tree, 'feature', 'merge feature');
      expect(merged.merged).toBeString();
      const parents = yield* shadow.run('parents', ['-C', tree, 'rev-list', '--parents', '-n', '1', 'HEAD']);
      expect([merged.merged, head, feature]).toEqual(parents.split(' '));
      expect((yield* shadow.log(tree)).slice(0, 1).map((act) => [act.author, act.message])).toEqual([['Tagma', 'merge feature']]);
    }),
  );

  it.effect('a pruned registration heals its stale marker without losing files and can commit again', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, gitDir, tree, shadow } = yield* world();
      yield* block(tree, 'doctrine', 'committed truth');
      yield* shadow.commitAct(tree, 'create doctrine');
      const hidden = join(base, 'hidden');
      yield* fs.rename(tree, hidden);
      yield* shadow.run('prune', ['--git-dir', gitDir, 'worktree', 'prune']);
      yield* fs.rename(hidden, tree);
      expect(yield* shadow.branchesAt([tree])).toEqual(new Set());
      yield* shadow.attach(tree, 'main');
      expect(yield* fs.readFileString(join(tree, 'doctrine.md'))).toBe('committed truth');
      expect(yield* shadow.run('status', ['-C', tree, 'status', '--porcelain'])).toBe('');
      yield* block(tree, 'doctrine', 'edited after the heal');
      expect(yield* shadow.commitAct(tree, 'edit after heal')).toBeString();
    }),
  );

  it.effect('a lost worktree restores whole and a later loss can be reattached at a new address', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, tree, shadow } = yield* world();
      yield* block(tree, 'doctrine', 'committed truth');
      yield* shadow.commitAct(tree, 'create doctrine');
      yield* fs.remove(tree, { recursive: true });
      yield* shadow.restore(tree, 'main');
      expect(yield* fs.readFileString(join(tree, 'doctrine.md'))).toBe('committed truth');
      yield* fs.remove(tree, { recursive: true });
      const reborn = join(base, 'reborn');
      yield* shadow.attach(reborn, 'main');
      expect(yield* fs.readFileString(join(reborn, 'doctrine.md'))).toBe('committed truth');
    }),
  );

  it.effect('attaching over another repository returns a typed refusal and preserves its branch', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { base, shadow } = yield* world();
      const foreign = join(base, 'foreign');
      yield* fs.makeDirectory(foreign);
      yield* runGit(yield* Git, 'init', ['init', '-b', 'main', foreign]);
      const refused = yield* Effect.flip(shadow.attach(foreign, 'main'));
      expect(refused).toMatchObject({ _tag: 'OwnGitFailed', op: 'attach', ran: true, reason: 'refused' });
      expect(yield* fs.readFileString(join(foreign, '.git', 'HEAD'))).toBe('ref: refs/heads/main\n');
    }),
  );
});
