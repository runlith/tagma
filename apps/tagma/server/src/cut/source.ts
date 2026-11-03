import { Console, Effect, FileSystem, Result, Schema } from 'effect';
import { ChildProcess } from 'effect/process';
import { join, relative, resolve } from 'node:path';
import { Git } from '@runlith/git/Git';
import { troubleOf } from '@runlith/git/repository';
import { statusAt } from '@runlith/git/status';
import { CurrentInvocation } from '../platform/cli/verb.js';
import { BUILD_CAPTURE_ENV, BUILD_CHECKOUT_ENV, BUILD_SOURCE_ENV, BUILD_WORKTREE_ENV } from '../installation/contract/wire/layout.js';
import { capturedSourceSchema } from '../installation/contract/wire/capture.js';
import { captureSource, SourceRefused } from './snapshot.js';

export type BuildHolding = {
  readonly path: string;
  readonly holders: readonly string[];
  readonly nobody: boolean;
  readonly unproven: string | null;
};

export type BuildAttribution = (checkout: string) => Effect.Effect<readonly BuildHolding[], string>;

type SourceBuild = {
  readonly checkout: string;
  readonly command: 'tagma:build' | 'tagma:release';
  readonly kind: 'head' | 'tree';
  readonly given: readonly string[];
  readonly inputs?: readonly string[];
  readonly clean?: boolean;
  readonly attribution?: BuildAttribution;
};

export const capturedSource = Effect.fnUntraced(function* (root: string) {
  const at = yield* CurrentInvocation;
  const text = at.env[BUILD_CAPTURE_ENV];
  if (at.env[BUILD_SOURCE_ENV] !== root || text === undefined) return null;
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(capturedSourceSchema))(text).pipe(
    Effect.mapError(
      (failure) =>
        new SourceRefused({
          message: `the captured source revision does not read: ${failure.message}`,
          unblock: ['build again from the source checkout'],
        }),
    ),
  );
});

const REFUSED_EXIT = 2;

const graphPath = (path: string): boolean => path === '.tagma' || path.startsWith('.tagma/');
const COMMIT = 'commit the changes to include them in HEAD';

export const buildSource = Effect.fn('installation.buildHead')(function* (input: SourceBuild) {
  const git = yield* Git;
  const files = yield* FileSystem.FileSystem;
  const at = yield* CurrentInvocation;
  const unblock =
    input.kind === 'tree'
      ? []
      : input.command === 'tagma:release'
        ? [COMMIT]
        : [COMMIT, 'bun run tagma:build --tree — deliberately build the working tree'];
  const failed = (message: string) => new SourceRefused({ message, unblock });
  const status = yield* statusAt(git, input.checkout, { untracked: 'all', monitor: false }).pipe(
    Effect.mapError((failure) => failed(troubleOf(failure))),
  );
  const paths = [
    ...new Set(
      Object.values(status.entries).flatMap((rows) =>
        rows.flatMap((row) => (row.oldPath === undefined ? [row.path] : [row.oldPath, row.path])),
      ),
    ),
  ].filter((path) => !graphPath(path));
  if (input.clean === true && paths.length > 0) {
    return yield* failed(`${input.checkout} has ${paths.length} uncommitted or untracked paths; a release is cut from a commit`);
  }
  if (input.kind === 'head') {
    yield* Console.error(`[tagma] building committed HEAD; leaving out ${paths.length} uncommitted paths`);
    if (paths.length > 0) {
      const read = yield* Effect.result(
        input.attribution === undefined ? Effect.fail('no change record is connected') : input.attribution(input.checkout),
      );
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
  }
  const snapshot = yield* captureSource({
    checkout: input.checkout,
    kind: input.kind,
    inputs: input.inputs ?? [],
    at: at.env[BUILD_WORKTREE_ENV],
  });
  const root = snapshot.root;
  const capture = Schema.encodeSync(Schema.fromJsonString(capturedSourceSchema))(snapshot);
  const runBuild = Effect.fn('installation.sourceCommand')(function* (args: readonly string[], cwd = root, entry = false) {
    const child = yield* ChildProcess.make(process.execPath, args, {
      cwd,
      env: { ...at.env, [BUILD_SOURCE_ENV]: root, [BUILD_CAPTURE_ENV]: capture, [BUILD_CHECKOUT_ENV]: input.checkout },
      extendEnv: false,
      detached: false,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    }).pipe(Effect.mapError((failure) => failed(failure.message)));
    const status = yield* child.exitCode.pipe(Effect.mapError((failure) => failed(failure.message)));
    if (status !== 0) {
      return yield* new SourceRefused({
        message: `${args.join(' ')} exited ${status} while building ${input.kind} of ${input.checkout}`,
        unblock,
        ...(entry && status === REFUSED_EXIT ? { exited: status } : {}),
      });
    }
  });
  if (yield* files.exists(join(root, 'bun.lock')).pipe(Effect.mapError((failure) => failed(failure.message)))) {
    yield* runBuild(['install', '--frozen-lockfile']);
  }
  const origin =
    input.command === 'tagma:build' && !input.given.includes('--portable') && !input.given.includes('--origin')
      ? ['--origin', input.checkout]
      : [];
  if (input.command === 'tagma:release') {
    const entry = relative(input.checkout, resolve(at.entry));
    if (entry === '..' || entry.startsWith('../')) return yield* failed(`${at.entry} is no release entry in ${input.checkout}`);
    yield* runBuild([...process.execArgv, join(root, entry), ...input.given], at.cwd, true);
  } else yield* runBuild(['run', input.command, ...input.given, ...origin], root, true);
}, Effect.scoped);
