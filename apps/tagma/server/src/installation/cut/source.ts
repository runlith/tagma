import { Console, Data, Effect, FileSystem, Result, type Scope } from 'effect';
import { ChildProcess } from 'effect/process';
import { dirname, join } from 'node:path';
import { Git } from '@runlith/git/Git';
import { commitOf, run, troubleOf } from '@runlith/git/repository';
import { statusAt } from '@runlith/git/status';
import { CurrentInvocation } from '../../platform/cli/verb.js';
import { BUILD_SOURCE_ENV, BUILD_WORKTREE_ENV } from '../contract/wire/layout.js';

export type BuildHolding = {
  readonly path: string;
  readonly holders: readonly string[];
  readonly nobody: boolean;
  readonly unproven: string | null;
};

export type BuildAttribution = (checkout: string) => Effect.Effect<readonly BuildHolding[], string>;

class SourceRefused extends Data.TaggedError('SourceRefused')<{
  readonly message: string;
  readonly unblock: readonly string[];
}> {}

const graphPath = (path: string): boolean => path === '.tagma' || path.startsWith('.tagma/');
const unblock = ['commit the changes to include them in HEAD', 'bun run tagma:build --tree — deliberately build the working tree'];

export const buildHead = Effect.fn('installation.buildHead')(function* (
  checkout: string,
  given: readonly string[],
  attribution: BuildAttribution | undefined,
) {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const at = yield* CurrentInvocation;
  const failed = (message: string) => new SourceRefused({ message, unblock });
  const commandIn = (cwd: string, args: readonly string[]) =>
    run(git, cwd, args, undefined).pipe(Effect.mapError((failure) => failed(troubleOf(failure))));
  const detached: (source: string, place: string, commit: string) => Effect.Effect<void, SourceRefused, Scope.Scope> = Effect.fn(
    'installation.headWorktree',
  )(function* (source: string, place: string, commit: string) {
    yield* Effect.acquireRelease(commandIn(source, ['worktree', 'add', '--detach', '--end-of-options', place, commit]), () =>
      Effect.matchEffect(commandIn(source, ['worktree', 'remove', '--force', '--force', place]), {
        onSuccess: () => Effect.void,
        onFailure: (failure) => Console.error(`[tagma] HEAD source cleanup failed: ${failure.message}; remove the worktree ${place}`),
      }),
    );
    for (const { path, pinned } of yield* submodulesOf(place)) {
      const repository = join(source, path);
      const unchecked = failed(`the submodule ${path} of ${source} is not checked out, so its pinned ${pinned} cannot be built`);
      yield* Effect.all([commandIn(repository, ['rev-parse', '--show-toplevel']), files.realPath(repository)]).pipe(
        Effect.mapError(() => unchecked),
        Effect.filterOrFail(
          ([top, real]) => top.trim() === real,
          () => unchecked,
        ),
      );
      yield* detached(repository, join(place, path), pinned);
    }
  });
  const submodulesOf = Effect.fn('installation.headSubmodules')(function* (place: string) {
    const declared = yield* files.exists(join(place, '.gitmodules')).pipe(Effect.mapError((failure) => failed(failure.message)));
    if (!declared) return [];
    const paths = yield* commandIn(place, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']);
    const named = paths.split('\n').flatMap((line) => {
      const path = line.trim().split(' ').slice(1).join(' ');
      return path === '' ? [] : [path];
    });
    if (named.length === 0) return [];
    const staged = yield* commandIn(place, ['ls-files', '--stage', '--', ...named]);
    return staged.split('\n').flatMap((line) => {
      const linked = /^160000 ([0-9a-f]+) 0\t(.+)$/u.exec(line);
      return linked?.[1] === undefined || linked[2] === undefined ? [] : [{ pinned: linked[1], path: linked[2] }];
    });
  });
  const [head, status] = yield* Effect.all([
    commitOf(git, checkout, 'HEAD'),
    statusAt(git, checkout, { untracked: 'all', monitor: false }),
  ]).pipe(Effect.mapError((failure) => failed(troubleOf(failure))));
  if (head === null) return yield* failed(`${checkout} has no committed HEAD to build`);
  const paths = [
    ...new Set(
      Object.values(status.entries).flatMap((rows) =>
        rows.flatMap((row) => (row.oldPath === undefined ? [row.path] : [row.oldPath, row.path])),
      ),
    ),
  ].filter((path) => !graphPath(path));
  yield* Console.error(`[tagma] building committed HEAD ${head}; leaving out ${paths.length} uncommitted paths`);
  if (paths.length > 0) {
    const read = yield* Effect.result(attribution === undefined ? Effect.fail('no change record is connected') : attribution(checkout));
    const holdings = Result.map(read, (rows) => new Map(rows.map((holding) => [holding.path, holding])));
    for (const path of paths) {
      const owners = Result.match(holdings, {
        onFailure: (reason) => `holders unavailable: ${reason}`,
        onSuccess: (rows) => {
          const holding = rows.get(path);
          return holding === undefined
            ? 'holders unread'
            : [
                ...holding.holders,
                ...(holding.nobody ? ['nobody'] : []),
                ...(holding.unproven === null ? [] : [`unproven: ${holding.unproven}`]),
              ].join(', ') || 'nobody recorded';
        },
      });
      yield* Console.error(`[tagma] left out ${path} — ${owners}`);
    }
    yield* Console.error(`[tagma] ${unblock.join('; ')}`);
  }
  const named = at.env[BUILD_WORKTREE_ENV];
  const root =
    named ??
    join(
      yield* files.makeTempDirectoryScoped({ prefix: 'tagma-head-' }).pipe(Effect.mapError((failure) => failed(failure.message))),
      'source',
    );
  yield* files.makeDirectory(dirname(root), { recursive: true }).pipe(Effect.mapError((failure) => failed(failure.message)));
  yield* detached(checkout, root, head);
  const snapshot = yield* files.realPath(root).pipe(Effect.mapError((failure) => failed(failure.message)));
  const runBuild = Effect.fn('installation.sourceCommand')(function* (args: readonly string[]) {
    const child = yield* ChildProcess.make(process.execPath, args, {
      cwd: root,
      env: { ...at.env, [BUILD_SOURCE_ENV]: snapshot },
      extendEnv: false,
      detached: false,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    }).pipe(Effect.mapError((failure) => failed(failure.message)));
    const status = yield* child.exitCode.pipe(Effect.mapError((failure) => failed(failure.message)));
    if (status !== 0) return yield* failed(`${args.join(' ')} exited ${status} while building committed HEAD ${head}`);
  });
  if (yield* files.exists(join(root, 'bun.lock')).pipe(Effect.mapError((failure) => failed(failure.message)))) {
    yield* runBuild(['install', '--frozen-lockfile']);
  }
  const origin = given.includes('--portable') || given.includes('--origin') ? [] : ['--origin', checkout];
  yield* runBuild(['run', 'tagma:build', ...given, ...origin]);
}, Effect.scoped);
