import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { Data, Duration, Effect, Fiber, FileSystem, Layer, Option, Stream } from 'effect';
import { ChildProcess } from 'effect/process';
import type { PlatformError } from 'effect/PlatformError';

export type ProgramEnded = { readonly status: 0; readonly stdout: string; readonly stderr: string };

export class ProgramUnavailable extends Data.TaggedError('ProgramUnavailable')<{ readonly detail: string }> {}

export class ProgramFailed extends Data.TaggedError('ProgramFailed')<{
  readonly phase: 'spawn' | 'read' | 'exit' | 'timeout';
  readonly detail: string;
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}> {}

export type ProgramFailure = ProgramUnavailable | ProgramFailed;

export type GitHubCli = {
  readonly run: (args: readonly string[], cwd: string, deadline?: Duration.Input) => Effect.Effect<ProgramEnded, ProgramFailure>;
};

export const spawnFailure = (failure: PlatformError, cwdPresent: boolean, cwd: string): ProgramFailure =>
  failure.reason._tag === 'NotFound' && cwdPresent
    ? new ProgramUnavailable({ detail: failure.message })
    : new ProgramFailed({ phase: 'spawn', detail: cwdPresent ? failure.message : `the working directory ${cwd} is absent` });

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const CAPTURE = 65_536;
const DEADLINE = '120 seconds';

const drained = <E>(bytes: Stream.Stream<Uint8Array, E>) =>
  Stream.runFold(
    Stream.decodeText(bytes),
    () => '',
    (text, chunk) => (text.length >= CAPTURE ? text : `${text}${chunk}`.slice(0, CAPTURE)),
  );

export const gitHubCli: GitHubCli = {
  run: (args, cwd, deadline = DEADLINE) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make('gh', args, { cwd, stdin: 'ignore' }).pipe(
          Effect.catchTag('PlatformError', (failure) =>
            failure.reason._tag === 'NotFound'
              ? Effect.flatMap(FileSystem.FileSystem, (files) =>
                  files.exists(cwd).pipe(
                    Effect.mapError((error) => new ProgramFailed({ phase: 'spawn', detail: error.message })),
                    Effect.flatMap((present) => Effect.fail(spawnFailure(failure, present, cwd))),
                  ),
                )
              : Effect.fail(spawnFailure(failure, true, cwd)),
          ),
        );
        const stdout = yield* Effect.forkScoped(
          drained(handle.stdout).pipe(Effect.mapError((failure) => new ProgramFailed({ phase: 'read', detail: String(failure) }))),
        );
        const stderr = yield* Effect.forkScoped(
          drained(handle.stderr).pipe(Effect.mapError((failure) => new ProgramFailed({ phase: 'read', detail: String(failure) }))),
        );
        const status = yield* handle.exitCode.pipe(
          Effect.mapError((failure) => new ProgramFailed({ phase: 'exit', detail: failure.message })),
        );
        const out = yield* Fiber.join(stdout);
        const err = yield* Fiber.join(stderr);
        if (status !== 0)
          return yield* new ProgramFailed({
            phase: 'exit',
            detail: err.trim() || out.trim() || `gh exited ${status}`,
            status,
            stdout: out,
            stderr: err,
          });
        return { status: 0 as const, stdout: out, stderr: err };
      }).pipe(
        Effect.timeoutOption(deadline),
        Effect.flatMap((ended) =>
          Option.match(ended, {
            onNone: () =>
              Effect.fail(
                new ProgramFailed({
                  phase: 'timeout',
                  detail: `gh did not end within ${Duration.format(Duration.fromInputUnsafe(deadline))}`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
      ),
    ).pipe(Effect.provide(Layer.mergeAll(HOST, BunFileSystem.layer))),
};
