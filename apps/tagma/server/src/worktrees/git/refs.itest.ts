import { it } from '@runlith/effect-test';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Effect, FileSystem, Layer } from 'effect';
import { Git, gitLayer } from '@runlith/git/Git';
import { run } from '@runlith/git/repository';
import { mergeTreeAt } from '@runlith/git/merge';
import { makeGitBranchRefs } from './refs.js';
import { branchRefContract } from '../testing/refContract.js';

const host = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)));
const live = Layer.merge(BunFileSystem.layer, gitLayer.pipe(Layer.provide(host)));

it.live('the real branch refs preserve names, publication and rename failures', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const path = yield* files.makeTempDirectoryScoped({ prefix: 'branch-refs-' });
    const git = yield* Git;
    yield* run(git, path, ['init', '-q', '-b', 'topic'], undefined);
    yield* run(git, path, ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit', '-q', '--allow-empty', '-m', 'born'], undefined);
    const base = (yield* run(git, path, ['rev-parse', 'HEAD'], undefined)).trim();
    yield* files.writeFileString(`${path}/work.txt`, 'user work\n');
    yield* run(git, path, ['add', 'work.txt'], undefined);
    yield* run(
      git,
      path,
      ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit', '-q', '-m', 'user work', '-m', 'tagma: graph @ 7 (amber-fox)'],
      undefined,
    );
    const work = (yield* run(git, path, ['rev-parse', 'HEAD'], undefined)).trim();
    yield* files.makeDirectory(`${path}/.tagma`);
    yield* files.writeFileString(`${path}/.tagma/note.md`, 'graph\n');
    yield* run(git, path, ['add', '.tagma/note.md'], undefined);
    yield* run(
      git,
      path,
      ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit', '-q', '-m', 'tagma: graph @ 7 (amber-fox)'],
      undefined,
    );
    const commit = (yield* run(git, path, ['rev-parse', 'HEAD'], undefined)).trim();
    const tree = (yield* run(git, path, ['rev-parse', 'HEAD^{tree}'], undefined)).trim();
    const squash = (yield* run(
      git,
      path,
      ['-c', 'user.email=git@test', '-c', 'user.name=git', 'commit-tree', tree, '-p', base, '-m', 'squashed work'],
      undefined,
    )).trim();
    const merged = (yield* mergeTreeAt(git, path, squash, commit)).tree;
    yield* run(git, path, ['branch', 'taken', squash], undefined);
    yield* run(git, path, ['branch', 'occupied/child'], undefined);
    yield* run(git, path, ['branch', 'tracked'], undefined);
    yield* run(git, path, ['config', 'branch.tracked.remote', 'origin'], undefined);
    yield* run(git, path, ['update-ref', 'refs/remotes/origin/topic', commit], undefined);
    yield* branchRefContract({ refs: yield* makeGitBranchRefs(), path, commit, base, work, tree, squash, merged });
  }).pipe(Effect.provide(live)),
);
