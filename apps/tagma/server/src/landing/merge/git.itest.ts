import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { join } from 'node:path';
import { Effect, FileSystem, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Git, gitLayer } from '@runlith/git/Git';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { WorkingOrigins } from '../../workspace/contract/service/places.js';
import { makeMergeGit } from './git.js';
import { verifyMergeGit } from '../testing/mergeConformance.js';

const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);
const host = Layer.merge(platform, gitLayer.pipe(Layer.provide(BunChildProcessSpawner.layer.pipe(Layer.provide(platform)))));
const unread = () => {
  throw new Error('the git conformance reached change records');
};
const boundary = Layer.mergeAll(
  host,
  Layer.mock(ChangeRecord, { changes: unread, unattributed: unread }),
  Layer.mock(LineWrites, {}),
  Layer.mock(CommitTrees, {}),
  Layer.mock(WorkingOrigins, {}),
);

it.live('the real merge repository preserves publication, checkout and recovery semantics', () =>
  Effect.gen(function* () {
    const files = yield* FileSystem.FileSystem;
    const git = yield* Git;
    const home = yield* files.makeTempDirectoryScoped({ prefix: 'merge-port-' });
    const main = join(home, 'main');
    const side = join(home, 'side');
    yield* files.makeDirectory(main);
    const run = Effect.fnUntraced(function* (path: string, args: readonly string[]) {
      const answer = yield* git.run(['-C', path, ...args]);
      if (answer.status !== 0) return yield* Effect.die(`git ${args.join(' ')}: ${answer.stderr}`);
      return answer.stdout.trim();
    });
    yield* run(main, ['init', '-q', '--initial-branch=main']);
    yield* run(main, ['config', 'user.name', 'Merge Contract']);
    yield* run(main, ['config', 'user.email', 'merge@example.invalid']);
    yield* run(main, ['config', 'commit.gpgsign', 'false']);
    yield* files.writeFileString(join(main, 'seed.txt'), 'seed\n');
    yield* run(main, ['add', 'seed.txt']);
    yield* run(main, ['commit', '-q', '-m', 'base']);
    const base = yield* run(main, ['rev-parse', 'HEAD']);
    yield* run(main, ['worktree', 'add', '-q', '-b', 'side', side]);
    yield* files.writeFileString(join(side, 'feature.txt'), 'feature\n');
    yield* run(side, ['add', 'feature.txt']);
    yield* run(side, ['commit', '-q', '-m', 'feature']);
    const tip = yield* run(side, ['rev-parse', 'HEAD']);
    const tree = yield* run(side, ['rev-parse', 'HEAD^{tree}']);
    const port = yield* makeMergeGit;
    yield* verifyMergeGit({
      git: port,
      main,
      side,
      base,
      tip,
      tree,
      write: (path, text) => Effect.orDie(files.writeFileString(join(main, path), text)),
      read: (path) => Effect.orDie(files.readFileString(join(main, path))),
      stage: (path, text) =>
        Effect.orDie(
          Effect.gen(function* () {
            yield* run(main, ['reset', '-q', '--mixed', 'HEAD']);
            yield* files.writeFileString(join(main, path), text);
            yield* run(main, ['add', '--', path]);
            return yield* run(main, ['write-tree']);
          }),
        ),

      interrupt: (sequenced) =>
        Effect.orDie(
          Effect.gen(function* () {
            yield* files.writeFileString(join(main, '.git', 'MERGE_HEAD'), `${tip}\n`);
            yield* files.writeFileString(join(main, '.git', 'MERGE_MSG'), 'interrupted\n\nTagma-Worktree: side-root\n');
            if (sequenced) yield* files.makeDirectory(join(main, '.git', 'sequencer'));
          }),
        ),
    });
    yield* files.remove(join(main, '.git', 'sequencer'), { recursive: true });
    yield* files.remove(join(main, '.git', 'MERGE_HEAD'));
    yield* run(main, ['config', '--unset', 'commit.gpgsign']);
    const global = join(home, 'global-config');
    yield* files.writeFileString(global, '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = /missing-merge-contract-signer\n');
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const before = process.env.GIT_CONFIG_GLOBAL;
        process.env.GIT_CONFIG_GLOBAL = global;
        return before;
      }),
      (before) =>
        Effect.sync(() => {
          if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
          else process.env.GIT_CONFIG_GLOBAL = before;
        }),
    );
    expect(yield* port.signing(main)).toBe(true);
    const unsigned = yield* Effect.flip(port.create(main, { tree, parents: [base], message: 'must sign', sign: true }));
    expect(unsigned._tag === 'WorktreeFinishRefused' ? unsigned.reason : unsigned._tag).toBe('commit-unsigned');
  }).pipe(Effect.provide(boundary)),
);
