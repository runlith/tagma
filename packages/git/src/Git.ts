import { Context, Data, Effect, Exit, Fiber, Layer, Stream, type Result } from 'effect';
import { makeObjectSessions } from './objects.js';
import type { PlatformError } from 'effect/PlatformError';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

export class GitUnavailable extends Data.TaggedError('GitUnavailable')<{
  readonly command: readonly string[];
  readonly reason: string;
}> {
  override get message(): string {
    return `git could not be started: ${this.reason} (${this.command.join(' ')})`;
  }
}

export class GitNotAdmitted extends Data.TaggedError('GitNotAdmitted')<{
  readonly command: readonly string[];
  readonly code: string;
  readonly reason: string;
  readonly unblock: readonly [string, ...string[]];
}> {
  override get message(): string {
    return `git was not admitted to run: ${this.code}: ${this.reason} (${this.command.join(' ')})`;
  }
}

export type GitAnswer = {
  readonly status: number;
  readonly stdout: string;
  readonly stdoutBytes?: Uint8Array;
  readonly stderr: string;
  readonly overflow: boolean;
  readonly messageOverflow: boolean;
};

export type GitOptions = {
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly extendEnv?: boolean;
  readonly stdin?: string | Uint8Array;
  readonly capture?: number;
  readonly stdoutBytes?: boolean;
};

export class GitEndingUnreadable extends Data.TaggedError('GitEndingUnreadable')<{
  readonly command: readonly string[];
  readonly reason: string;
}> {
  override get message(): string {
    return `git ran and how it ended could not be read: ${this.reason} (${this.command.join(' ')})`;
  }
}

export class GitBatchUnsupported extends Data.TaggedError('GitBatchUnsupported')<{
  readonly command: readonly string[];
  readonly reason: string;
}> {}

export type GitObject = {
  readonly type: string;
  readonly size: number;
  readonly bytes: Uint8Array;
  readonly overflow: boolean;
};

export type GitObjectAt = Result.Result<
  GitObject | null,
  PlatformError | GitUnavailable | GitEndingUnreadable | GitNotAdmitted | GitBatchUnsupported
>;

export class Git extends Context.Service<
  Git,
  {
    run(
      args: readonly string[],
      options?: GitOptions,
    ): Effect.Effect<GitAnswer, PlatformError | GitUnavailable | GitEndingUnreadable | GitNotAdmitted>;
    objects?(dir: string, oids: readonly string[], options?: GitOptions): Effect.Effect<readonly GitObjectAt[]>;
  }
>()('@runlith/git/Git') {}

const drain = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  capture: number | undefined,
): Effect.Effect<{ readonly text: string; readonly overflow: boolean }, E, R> => {
  const text = Stream.suspend(() => {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
    return Stream.map(bytes, (chunk) => decoder.decode(chunk, { stream: true }));
  });
  if (capture === undefined) return Effect.map(Stream.mkString(text), (whole) => ({ text: whole, overflow: false }));
  return Effect.map(
    Stream.runFold(
      text,
      () => ({ kept: '', size: 0 }),
      (seen, chunk) => {
        const size = seen.size + chunk.length;
        return { kept: seen.kept.length >= capture ? seen.kept : (seen.kept + chunk).slice(0, capture), size };
      },
    ),
    (seen) => ({ text: seen.kept, overflow: seen.size > capture }),
  );
};

const drainBytes = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  capture: number | undefined,
): Effect.Effect<{ readonly bytes: Uint8Array; readonly overflow: boolean }, E, R> =>
  Effect.map(
    Stream.runFold(
      bytes,
      () => ({ chunks: [] as Uint8Array[], kept: 0, size: 0 }),
      (seen, chunk) => {
        const room = capture === undefined ? chunk.length : Math.max(0, capture - seen.kept);
        if (room > 0) seen.chunks.push(room < chunk.length ? chunk.subarray(0, room) : chunk);
        return { chunks: seen.chunks, kept: seen.kept + Math.min(room, chunk.length), size: seen.size + chunk.length };
      },
    ),
    (seen) => {
      const whole = new Uint8Array(seen.kept);
      let at = 0;
      for (const chunk of seen.chunks) {
        whole.set(chunk, at);
        at += chunk.length;
      }
      return { bytes: whole, overflow: capture !== undefined && seen.size > capture };
    },
  );

const drainStdout = <E, R>(
  bytes: Stream.Stream<Uint8Array, E, R>,
  options: GitOptions | undefined,
): Effect.Effect<{ readonly text: string; readonly bytes?: Uint8Array; readonly overflow: boolean }, E, R> =>
  options?.stdoutBytes === true
    ? Effect.map(drainBytes(bytes, options.capture), (drained) => ({ text: '', ...drained }))
    : drain(bytes, options?.capture);

const FORCE_KILL_AFTER = '1 second';

export const gitVerb = (args: readonly string[]): string => {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '-C' || arg === '-c' || arg === '--git-dir') at += 1;
    else if (!arg.startsWith('-')) return arg;
  }
  return '';
};

export const spawnGit = Effect.fn('Git.spawn')(function* (
  args: readonly string[],
  options?: GitOptions,
): Effect.fn.Return<GitAnswer, PlatformError | GitUnavailable, ChildProcessSpawner.ChildProcessSpawner> {
  yield* Effect.annotateCurrentSpan({ 'git.verb': gitVerb(args), ...(options?.cwd === undefined ? {} : { 'git.cwd': options.cwd }) });
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('git', args, {
        cwd: options?.cwd,
        env: options?.env,
        extendEnv: options?.extendEnv,
        stdin: options?.stdin === undefined ? 'ignore' : 'pipe',
        forceKillAfter: FORCE_KILL_AFTER,
      }).pipe(Effect.mapError((failure) => new GitUnavailable({ command: args, reason: failure.message })));
      //! a referenced group is signalled whole even after git exits cleanly, killing the fsmonitor daemon git started in it
      const reref = yield* handle.unref.pipe(Effect.mapError((failure) => new GitUnavailable({ command: args, reason: failure.message })));
      yield* Effect.addFinalizer((exit) => (Exit.isSuccess(exit) ? Effect.void : Effect.orDie(reref)));
      if (options?.stdin !== undefined) {
        const bytes = typeof options.stdin === 'string' ? new TextEncoder().encode(options.stdin) : options.stdin;
        yield* Effect.forkScoped(Stream.run(Stream.make(bytes), handle.stdin));
      }
      const stdout = yield* Effect.forkScoped(drainStdout(handle.stdout, options));
      const stderr = yield* Effect.forkScoped(drain(handle.stderr, options?.capture));
      const status = yield* handle.exitCode;
      const out = yield* Fiber.join(stdout);
      const errors = yield* Fiber.join(stderr);
      return {
        status,
        stdout: out.text,
        stdoutBytes: out.bytes,
        stderr: errors.text,
        overflow: out.overflow,
        messageOverflow: errors.overflow,
      };
    }),
  );
});

export const gitLayer: Layer.Layer<Git, never, ChildProcessSpawner.ChildProcessSpawner> = Layer.effect(
  Git,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return Git.of({
      run: (args, options) => Effect.provideService(spawnGit(args, options), ChildProcessSpawner.ChildProcessSpawner, spawner),
      objects: yield* makeObjectSessions,
    });
  }),
);
