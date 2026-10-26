import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { unmergedReader } from './unmerged.js';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'operator',
  GIT_AUTHOR_EMAIL: 'operator@test',
  GIT_COMMITTER_NAME: 'operator',
  GIT_COMMITTER_EMAIL: 'operator@test',
};

const run = (args: string[], cwd: string) => Effect.flatMap(Git, (git) => git.run(args, { cwd, env: { ...process.env, ...IDENTITY } }));

const committed = Effect.fnUntraced(function* (tree: string, file: string, body: string, message: string) {
  yield* (yield* FileSystem.FileSystem).writeFileString(join(tree, file), body);
  yield* run(['add', '-A'], tree);
  const done = yield* run(['commit', '-q', '-m', message], tree);
  if (done.status !== 0) return yield* Effect.die(new Error(`commit ${message} failed`));
});

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('unmerged reading', (it) => {
  it.effect('the unmerged reading sees a merge begun after its last answer, and lets it go once concluded', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const base = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'unmerged-' });
      const tree = join(base, 'tree');
      yield* run(['init', '-q', '-b', 'main', tree], base);
      yield* committed(tree, 'law.md', 'the original', 'create law');
      yield* run(['branch', 'rival'], tree);
      yield* run(['switch', '-q', 'rival'], tree);
      yield* committed(tree, 'law.md', 'the rival truth', 'edit law on rival');
      yield* run(['switch', '-q', 'main'], tree);
      yield* committed(tree, 'law.md', 'the main truth', 'edit law on main');

      const unmerged = unmergedReader(git, tree);
      expect(yield* unmerged).toEqual([]);
      expect(yield* unmerged).toEqual([]);
      expect((yield* run(['merge', '-q', 'rival', '-m', 'merge rival'], tree)).status).not.toBe(0);
      expect(yield* unmerged).toEqual(['law.md']);
      yield* committed(tree, 'law.md', 'the merged truth', 'conclude the merge');
      expect(yield* unmerged).toEqual([]);
    }),
  );
});
