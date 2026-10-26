import { join } from 'node:path';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { headNamed } from './readings.js';

const run = (cwd: string, ...args: string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(['-c', 'user.name=op', '-c', 'user.email=op@x', ...args], { cwd }), (out) =>
      out.status === 0 ? Effect.void : Effect.die(new Error(`git ${args.join(' ')}: ${out.stderr}`)),
    ),
  );

layer(Layer.merge(BunFileSystem.layer, liveGitLayer), { excludeTestServices: true })('head naming', (it) => {
  it.effect('a directory that is no repository has no HEAD, and a repository names its branch', () =>
    Effect.gen(function* () {
      const git = yield* Git;
      const files = yield* FileSystem.FileSystem;
      const base = yield* files.makeTempDirectoryScoped({ prefix: 'head-named-' });
      expect(yield* headNamed(git, base)).toBeNull();
      const repo = join(base, 'repo');
      yield* run(base, 'init', '-q', '-b', 'main', repo);
      yield* files.writeFileString(join(repo, 'a.md'), 'a\n');
      yield* run(repo, 'add', '-A');
      yield* run(repo, 'commit', '-qm', 'first');
      expect(yield* headNamed(git, repo)).toBe('refs/heads/main');
    }),
  );
});
