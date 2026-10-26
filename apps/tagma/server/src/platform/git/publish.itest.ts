import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { GitUnavailable, Git } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { publish } from './publish.js';
import { standingOf } from './places.js';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'operator',
  GIT_AUTHOR_EMAIL: 'operator@test',
  GIT_COMMITTER_NAME: 'operator',
  GIT_COMMITTER_EMAIL: 'operator@test',
};

const run = (args: string[], cwd: string, env: Record<string, string> = {}) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd, env: { ...process.env, ...IDENTITY, ...env } }), (result) =>
      result.status === 0 ? Effect.succeed(result.stdout.trim()) : Effect.die(new Error(`git ${args.join(' ')}: ${result.stderr}`)),
    ),
  );

const prepared = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const base = yield* files.makeTempDirectoryScoped({ prefix: 'publish-' });
  const tree = join(base, 'tree');
  yield* run(['init', '-q', '-b', 'main', tree], base);
  yield* files.writeFileString(join(tree, 'a.txt'), 'one\n');
  yield* files.writeFileString(join(tree, 'b.txt'), 'one\n');
  yield* run(['add', '-A'], tree);
  yield* run(['commit', '-q', '-m', 'start'], tree);
  const head = yield* run(['rev-parse', 'HEAD'], tree);
  const blobA = yield* run(['rev-parse', 'HEAD:a.txt'], tree);
  const blobB = yield* run(['rev-parse', 'HEAD:b.txt'], tree);
  yield* files.writeFileString(join(tree, 'a.txt'), 'two\n');
  yield* files.writeFileString(join(tree, 'b.txt'), 'two\n');
  const scratch = join(base, 'index');
  yield* run(['read-tree', head], tree, { GIT_INDEX_FILE: scratch });
  yield* run(['add', 'a.txt', 'b.txt'], tree, { GIT_INDEX_FILE: scratch });
  const built = yield* run(['write-tree'], tree, { GIT_INDEX_FILE: scratch });
  const landedA = yield* run(['rev-parse', `${built}:a.txt`], tree);
  const landedB = yield* run(['rev-parse', `${built}:b.txt`], tree);
  return {
    base,
    tree,
    publication: {
      checkout: tree,
      ref: 'refs/heads/main',
      base: head,
      tree: built,
      message: 'landed\n',
      job: 'job-1',
      entries: [
        { path: 'a.txt', base: blobA, landed: landedA },
        { path: 'b.txt', base: blobB, landed: landedB },
      ],
    },
  };
});

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('git publication', (it) => {
  it.effect('a publication moves the ref by compare-and-set and settles index entries still at the base, leaving a staged one', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { tree, publication } = yield* prepared;
      yield* (yield* FileSystem.FileSystem).writeFileString(join(tree, 'b.txt'), 'staged by the user\n');
      yield* run(['add', 'b.txt'], tree);
      const witnessed: string[] = [];
      const outcome = yield* publish(git, publication, (commit) => Effect.sync(() => void witnessed.push(commit)));
      expect(outcome.outcome).toBe('published');
      if (outcome.outcome !== 'published' || !('paths' in outcome.settlement)) return yield* Effect.die('not settled');
      expect(yield* run(['rev-parse', 'HEAD'], tree)).toBe(outcome.commit);
      expect(witnessed).toEqual([outcome.commit]);
      expect(Object.fromEntries(outcome.settlement.paths)).toEqual({ 'a.txt': 'synced', 'b.txt': 'unsynced' });
      expect(yield* run(['reflog', 'show', '-1', '--format=%gs', 'refs/heads/main'], tree)).toBe('tagma landing job-1');
      expect(yield* run(['diff', '--cached', '--name-only', 'HEAD'], tree)).toBe('b.txt');
    }),
  );

  it.effect('a publication whose update-ref answer is lost still settles the index and returns its commit', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { tree, publication } = yield* prepared;
      const unread: Git['Service'] = {
        run: (args, options) =>
          args.includes('update-ref')
            ? Effect.flatMap(git.run(args, options), () =>
                Effect.fail(new GitUnavailable({ command: args, reason: 'the published command console could not be read' })),
              )
            : git.run(args, options),
      };

      const outcome = yield* publish(unread, publication, () => Effect.void);

      expect(outcome.outcome).toBe('published');
      if (outcome.outcome !== 'published' || !('paths' in outcome.settlement)) return yield* Effect.die('not settled');
      expect(outcome.commit).toBe(yield* run(['rev-parse', 'HEAD'], tree));
      expect(Object.fromEntries(outcome.settlement.paths)).toEqual({ 'a.txt': 'synced', 'b.txt': 'synced' });
      expect(yield* run(['status', '--porcelain'], tree)).toBe('');
    }),
  );

  it.effect('one standing read answers the layout and what HEAD points at on a branch, detached, unborn and in a linked worktree', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { base, tree } = yield* prepared;
      const fresh = join(base, 'fresh');
      yield* run(['init', '-q', '-b', 'trunk', fresh], base);
      const linked = join(base, 'linked');
      yield* run(['worktree', 'add', '-q', '-b', 'side', linked], tree);
      yield* run(['checkout', '-q', '--detach'], tree);
      const asked = [
        'rev-parse',
        '--absolute-git-dir',
        '--path-format=absolute',
        '--git-path',
        'index',
        '--git-path',
        'hooks',
        '--git-path',
        'MERGE_HEAD',
      ];
      for (const [root, ref, sha] of [
        [tree, null, yield* run(['rev-parse', 'HEAD'], tree)],
        [linked, 'refs/heads/side', yield* run(['rev-parse', 'HEAD'], linked)],
        [fresh, 'refs/heads/trunk', null],
      ] as const) {
        const [gitDir, index, hooks, merge = ''] = (yield* run(asked, root)).split('\n');
        const standing = yield* standingOf(git, root);
        expect(standing.head).toEqual({ ref, commit: sha });
        expect(standing.places).toMatchObject({ gitDir, index, hooks });
        expect(standing.places.operations).toContain(merge);
      }
    }),
  );

  it.effect('a hooks path with a line break in it is read whole and leaves every operation file where git keeps it', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { tree } = yield* prepared;
      yield* run(['config', 'core.hooksPath', 'hooks\ncontinued'], tree);
      const standing = yield* standingOf(git, tree);
      expect(standing.places.hooks).toBe(yield* run(['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], tree));
      expect(standing.places.operations).toContain(yield* run(['rev-parse', '--path-format=absolute', '--git-path', 'REVERT_HEAD'], tree));
      expect(standing.head).toEqual({ ref: 'refs/heads/main', commit: yield* run(['rev-parse', 'HEAD'], tree) });
    }),
  );

  it.effect('a ref moved since the judged base leaves the lane and publishes nothing', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { tree, publication } = yield* prepared;
      yield* run(['commit', '-q', '--allow-empty', '-m', 'outside'], tree);
      const moved = yield* run(['rev-parse', 'HEAD'], tree);
      const outcome = yield* publish(git, publication, () => Effect.void);
      expect(outcome).toEqual({ outcome: 'moved', ref: 'refs/heads/main', sha: moved });
    }),
  );

  it.effect('a checkout switched to another branch at the same commit publishes nothing onto either branch', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const { tree, publication } = yield* prepared;
      yield* run(['checkout', '-q', '-b', 'other'], tree);
      const outcome = yield* publish(git, publication, () => Effect.void);
      expect(outcome).toEqual({ outcome: 'moved', ref: 'refs/heads/other', sha: publication.base });
      expect(yield* run(['rev-parse', 'main', 'other'], tree)).toBe(`${publication.base}\n${publication.base}`);
    }),
  );
});
