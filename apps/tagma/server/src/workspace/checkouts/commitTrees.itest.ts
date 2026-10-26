import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { type CommitTrees, type TreeReach, WHOLE_TREE } from '../contract/service/commitTrees.js';
import { keyOf, makeGitCommitTrees } from './commitTrees.js';

type HookRepo = { readonly root: string; readonly home: string };

const HOOKS = ['.gitignore', 'h', 'pre-commit', 'commit-msg', 'post-commit', 'prepare-commit-msg', 'pre-push', 'post-merge'];

const text = (name: string): string => (name === '.gitignore' ? '*\n' : `${name}\n`);

const run = (root: string, ...args: string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root }), (answer) =>
      answer.status === 0 ? Effect.succeed(answer.stdout.trim()) : Effect.die(new Error(answer.stderr)),
    ),
  );

const husky = Effect.fnUntraced(function* (name: string) {
  const files = yield* FileSystem.FileSystem;
  const home = yield* files.makeTempDirectoryScoped({ prefix: 'commit-trees-' });
  const root = join(home, name);
  yield* files.makeDirectory(join(root, '.husky', '_'), { recursive: true });
  yield* run(root, 'init', '-q');
  yield* files.writeFileString(join(root, '.husky', 'pre-commit'), 'npx lint-staged\n');
  yield* run(root, 'add', '-A');
  yield* run(root, 'commit', '-q', '-m', 'husky');
  for (const name of HOOKS) yield* files.writeFileString(join(root, '.husky', '_', name), text(name));
  return { root, home } satisfies HookRepo;
});

const linkIn = Effect.fnUntraced(function* (root: string, trees: CommitTrees['Service']) {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  return yield* trees.within(git, root, join(root, '.git'), yield* run(root, 'rev-parse', 'HEAD^{tree}'), WHOLE_TREE, (place) =>
    files.readLink(join(place.dir, '.husky', '_')),
  );
});

const untouched = Effect.fnUntraced(function* (root: string) {
  const files = yield* FileSystem.FileSystem;
  for (const name of HOOKS) {
    yield* Effect.sync(() => expect(lstatSync(join(root, '.husky', '_', name)).isFile()).toBe(true));
    expect(yield* files.readFileString(join(root, '.husky', '_', name))).toBe(text(name));
  }
});

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('commit trees', (it) => {
  it.effect(
    'an ignored directory that ignores its own contents is linked whole on every use, and its files in the checkout stay as they were',
    () =>
      Effect.gen(function* () {
        const { root, home } = yield* husky('linked');
        const trees = yield* makeGitCommitTrees({ base: join(home, 'linked-trees') });
        for (const _ of [1, 2]) expect(yield* linkIn(root, trees)).toBe(join(root, '.husky', '_'));
        yield* untouched(root);
      }),
  );

  it.effect('a hook use after a steps use finds every tracked file of the commit in the tree', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const files = yield* FileSystem.FileSystem;
      const { root, home } = yield* husky('whole');
      yield* files.makeDirectory(join(root, 'src'));
      yield* files.makeDirectory(join(root, 'docs'));
      yield* files.writeFileString(join(root, 'src', 'a.ts'), 'a\n');
      yield* files.writeFileString(join(root, 'docs', 'b.md'), 'b\n');
      yield* run(root, 'add', '-A');
      yield* run(root, 'commit', '-q', '-m', 'files');
      const tree = yield* run(root, 'rev-parse', 'HEAD^{tree}');
      const trees = yield* makeGitCommitTrees({ base: join(home, 'whole-trees') });
      const read = (reach: TreeReach, path: string) =>
        trees.within(git, root, join(root, '.git'), tree, reach, (place) => files.readFileString(join(place.dir, path)));
      expect(yield* read({ _tag: 'nearby', paths: ['src/a.ts'], uses: [] }, 'src/a.ts')).toBe('a\n');
      expect(yield* read(WHOLE_TREE, 'docs/b.md')).toBe('b\n');
    }),
  );

  it.effect("a tree whose last link list names paths under a linked directory is relinked without touching the checkout's files", () =>
    Effect.gen(function* () {
      const files = yield* FileSystem.FileSystem;
      const { root, home } = yield* husky('relinked');
      const base = join(home, 'relinked-trees');
      const trees = yield* makeGitCommitTrees({ base });
      expect(yield* linkIn(root, trees)).toBe(join(root, '.husky', '_'));
      const nested = [...HOOKS.map((name) => `.husky/_/${name}`), '.husky/_'];
      yield* files.writeFileString(join(base, keyOf(root), 'links'), nested.map((path) => `${path}\0`).join(''));
      expect(yield* linkIn(root, trees)).toBe(join(root, '.husky', '_'));
      yield* untouched(root);
    }),
  );
});
