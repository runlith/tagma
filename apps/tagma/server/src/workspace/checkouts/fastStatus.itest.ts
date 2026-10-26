import { layer } from '@runlith/effect-test';
import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { configValueAt } from '@runlith/git/repository';
import { liveGitLayer } from '../../composition/testing/liveGit.js';
import { MONITOR, UNTRACKED, disableSpeedup, enableSpeedup } from './fastStatus.js';

const configuration = Layer.effectDiscard(
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'fast-status-config-' });
    const global = join(home, 'global');
    yield* files.writeFileString(global, '');
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const before = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
        process.env.GIT_CONFIG_GLOBAL = global;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        return before;
      }),
      (before) =>
        Effect.sync(() => {
          if (before.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
          else process.env.GIT_CONFIG_GLOBAL = before.global;
          if (before.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
          else process.env.GIT_CONFIG_NOSYSTEM = before.system;
        }),
    );
  }),
).pipe(Layer.provideMerge(BunFileSystem.layer));

const run = (dir: string, args: readonly string[]) =>
  Effect.flatMap(Git, (git) =>
    Effect.flatMap(git.run(args, { cwd: dir }), (answer) =>
      answer.status === 0 ? Effect.void : Effect.die(new Error(`git ${args.join(' ')}: ${answer.stderr}`)),
    ),
  );

const repo = Effect.fnUntraced(function* (name: string, local: readonly (readonly [string, string])[] = []) {
  const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: `fast-status-${name}-` });
  yield* run(dir, ['init', '-q']);
  for (const [key, value] of local) yield* run(dir, ['config', '--local', key, value]);
  return dir;
});

const local = (dir: string, key: string) =>
  Effect.flatMap(Git, (git) => Effect.map(configValueAt(git, dir, key, { local: true }), (found) => found?.value ?? null));

layer(liveGitLayer.pipe(Layer.provideMerge(configuration)), { excludeTestServices: true })(
  'git speedups in the repository config',
  (it) => {
    it.effect('each speedup writes only its own key and mark, and off removes exactly those', () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const dir = yield* repo('fresh');
        expect(yield* enableSpeedup(git, dir, UNTRACKED)).toBeNull();
        expect(yield* local(dir, 'core.untrackedCache')).toBe('true');
        expect(yield* local(dir, UNTRACKED.mark)).toBe('true');
        expect(yield* local(dir, 'core.fsmonitor')).toBeNull();
        yield* enableSpeedup(git, dir, MONITOR);
        yield* disableSpeedup(git, dir, UNTRACKED);
        expect(yield* local(dir, 'core.untrackedCache')).toBeNull();
        expect(yield* local(dir, UNTRACKED.mark)).toBeNull();
        expect(yield* local(dir, 'core.fsmonitor')).toBe('true');
      }),
    );

    it.effect("a user's equal value is left unmarked, so off keeps it", () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const dir = yield* repo('users-equal', [['core.untrackedCache', 'true']]);
        expect(yield* enableSpeedup(git, dir, UNTRACKED)).toBeNull();
        expect(yield* local(dir, UNTRACKED.mark)).toBeNull();
        yield* disableSpeedup(git, dir, UNTRACKED);
        expect(yield* local(dir, 'core.untrackedCache')).toBe('true');
      }),
    );

    it.effect("a user's different value is reported and nothing is written", () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const dir = yield* repo('users-different', [['core.untrackedCache', 'false']]);
        expect(yield* enableSpeedup(git, dir, UNTRACKED)).toEqual({ key: 'core.untrackedCache', value: 'false', scope: 'local' });
        expect(yield* local(dir, 'core.untrackedCache')).toBe('false');
        expect(yield* local(dir, UNTRACKED.mark)).toBeNull();
      }),
    );

    it.effect('a value the user changed after Tagma wrote it survives off', () =>
      Effect.gen(function* () {
        const git = yield* Git;
        const dir = yield* repo('changed-after');
        yield* enableSpeedup(git, dir, UNTRACKED);
        yield* run(dir, ['config', '--local', 'core.untrackedCache', 'keep']);
        yield* disableSpeedup(git, dir, UNTRACKED);
        expect(yield* local(dir, 'core.untrackedCache')).toBe('keep');
        expect(yield* local(dir, UNTRACKED.mark)).toBeNull();
      }),
    );
  },
);
