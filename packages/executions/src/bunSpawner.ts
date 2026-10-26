import { Effect, Layer, type Scope, Sink, Stream } from 'effect';
import * as PlatformError from 'effect/PlatformError';
import * as ChildProcess from 'effect/process/ChildProcess';
import type { Command, CommandOptions, KillOptions } from 'effect/process/ChildProcess';
import {
  type ChildProcessHandle,
  ChildProcessSpawner,
  ExitCode,
  make as makeSpawner,
  makeHandle,
  ProcessId,
} from 'effect/process/ChildProcessSpawner';
import type { ProcessCost } from './protocol/execution';
import { runtimeCost } from './runtimeCost';

export type SpawnerOptions = { readonly detached?: boolean };

export const ProcessCostTypeId = '~runlith/agent-tools/ProcessCost';

export const processCost = (handle: ChildProcessHandle): ProcessCost | undefined =>
  (handle as { readonly [ProcessCostTypeId]?: () => ProcessCost })[ProcessCostTypeId]?.();

export const ProcessGroupTypeId = '~runlith/agent-tools/ProcessGroup';

export type ProcessGroup = {
  readonly signal: (signal: string) => void;
  readonly standing: () => boolean;
};

export const processGroup = (handle: ChildProcessHandle): ProcessGroup | undefined =>
  (handle as { readonly [ProcessGroupTypeId]?: ProcessGroup })[ProcessGroupTypeId];

const groupOf = (child: Started): ProcessGroup => ({
  signal: (signal) => {
    try {
      globalThis.process.kill(-child.pid, signal as NodeJS.Signals);
    } catch {}
  },
  standing: () => {
    try {
      globalThis.process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return (error as { readonly code?: unknown }).code !== 'ESRCH';
    }
  },
});

const refuse = (method: string, description: string): Effect.Effect<never, PlatformError.PlatformError> =>
  Effect.fail(PlatformError.badArgument({ module: 'runtimeSpawner', method, description }));

const signalled = (signal: NodeJS.Signals | number) =>
  PlatformError.systemError({
    _tag: 'Unknown',
    module: 'runtimeSpawner',
    method: 'exitCode',
    description: `Process interrupted due to receipt of signal: '${signal}'`,
  });

const failed = (method: string, cause: unknown) =>
  PlatformError.systemError({
    _tag: 'Unknown',
    module: 'runtimeSpawner',
    method,
    description: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

const streamOption = (option: CommandOptions['stdin'] | CommandOptions['stdout']): unknown =>
  option !== undefined && typeof option === 'object' && !Stream.isStream(option) && !Sink.isSink(option)
    ? 'stream' in option
      ? option.stream
      : undefined
    : option;

const stdio = (named: unknown): 'pipe' | 'inherit' | 'ignore' | undefined => {
  if (named === undefined || named === 'pipe' || named === 'overlapped') return 'pipe';
  if (named === 'inherit') return 'inherit';
  if (named === 'ignore') return 'ignore';
  return undefined;
};

const environment = (options: CommandOptions): Record<string, string> => {
  const inherit = options.env === undefined || options.extendEnv === true;
  const resolved = new Map<string, string>();
  if (inherit) {
    for (const [name, value] of Object.entries(process.env)) if (value !== undefined) resolved.set(name, value);
  }
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (name.length === 0) continue;
    if (value === undefined) resolved.delete(name);
    else resolved.set(name, value);
  }
  return Object.fromEntries(resolved);
};

type Started = Bun.Subprocess<'pipe' | 'inherit' | 'ignore', 'pipe' | 'inherit' | 'ignore', 'pipe' | 'inherit' | 'ignore'>;

const bytes = (source: ReadableStream<Uint8Array> | undefined, method: string): Stream.Stream<Uint8Array, PlatformError.PlatformError> =>
  source === undefined ? Stream.empty : Stream.fromReadableStream({ evaluate: () => source, onError: (cause) => failed(method, cause) });

const pipedInput = (command: Command): Command =>
  command._tag === 'StandardCommand'
    ? ChildProcess.make(command.command, command.args, { ...command.options, stdin: 'pipe' })
    : ChildProcess.pipeTo(pipedInput(command.left), command.right, command.options);

const spawn = Effect.fnUntraced(function* (
  command: Command,
  defaults: SpawnerOptions,
): Effect.fn.Return<ChildProcessHandle, PlatformError.PlatformError, Scope.Scope> {
  if (command._tag === 'PipedCommand') {
    const source = yield* spawn(command.left, defaults);
    const output = command.options.from;
    const stream = output === undefined || output === 'stdout' ? source.stdout : output === 'stderr' ? source.stderr : source.all;
    if (
      (output !== undefined && output !== 'stdout' && output !== 'stderr' && output !== 'all') ||
      (command.options.to !== undefined && command.options.to !== 'stdin')
    )
      return yield* refuse('spawn', 'additional file descriptors are not an arrangement this spawner makes');
    const destination = yield* spawn(pipedInput(command.right), defaults);
    yield* Effect.forkScoped(Stream.run(stream, destination.stdin));
    return makeHandle({
      ...destination,
      stdin: source.stdin,
      kill: (options) => Effect.andThen(destination.kill(options), source.kill(options)),
      unref: Effect.gen(function* () {
        const first = yield* source.unref;
        const last = yield* destination.unref;
        return Effect.andThen(last, first);
      }),
    });
  }
  const options = command.options;
  const leads = process.platform !== 'win32' && (options.detached ?? defaults.detached) === true;
  let referenced = true;
  if (options.shell !== undefined && options.shell !== false) {
    return yield* refuse('spawn', 'a shell command must name its shell as the program it runs: this spawner expands no command line');
  }
  if (options.additionalFds !== undefined && Object.keys(options.additionalFds).length > 0) {
    return yield* refuse('spawn', 'additional file descriptors are not an arrangement this spawner makes');
  }
  const stdinNamed = streamOption(options.stdin);
  const stdoutNamed = streamOption(options.stdout);
  const stderrNamed = streamOption(options.stderr);
  const stdin = Stream.isStream(stdinNamed) ? 'pipe' : stdio(stdinNamed);
  const stdout = stdio(stdoutNamed);
  const stderr = stdio(stderrNamed);
  if (stdin === undefined || stdout === undefined || stderr === undefined) {
    return yield* refuse(
      'spawn',
      'a stdin stream and an output sink are pumped by whoever asked for them; this spawner arranges pipes, inherit and ignore',
    );
  }
  const endOnDone =
    options.stdin !== undefined && typeof options.stdin === 'object' && !Stream.isStream(options.stdin)
      ? options.stdin.endOnDone !== false
      : true;

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        Bun.spawn({
          cmd: [command.command, ...command.args],
          cwd: options.cwd,
          env: environment(options),
          stdin,
          stdout,
          stderr,
          detached: leads,
          onExit: (child, code) => {
            if (!leads || code === null || code === 0) return;
            Effect.runFork(
              deliver(child, options.killSignal ?? 'SIGTERM', leads).pipe(
                Effect.catchTag('PlatformError', (cause) => Effect.logWarning('Releasing a failed process group failed', cause)),
              ),
            );
          },
        }) as Started,
      catch: (cause) => failed('spawn', cause),
    }),
    (child) => {
      if (child.exitCode === 0 && !referenced) return Effect.void;
      if (!referenced && child.exitCode === null && child.signalCode === null) return Effect.void;
      if (!leads && (child.exitCode !== null || child.signalCode !== null)) return Effect.void;
      return end(child, options, leads).pipe(
        Effect.catchTag('PlatformError', (cause) => Effect.logWarning('Releasing a child process failed', cause)),
      );
    },
  );

  let measured: ProcessCost | undefined;
  const reaped = () => child.exitCode !== null || child.signalCode !== null;
  const costOf = (): ProcessCost =>
    measured ??
    (!reaped()
      ? {
          _tag: 'Unmeasured',
          reason: 'unknown',
          detail: 'this child has not been reaped, so the kernel has completed no accounting for it',
        }
      : (measured = runtimeCost(child)));

  const ended = Effect.map(
    Effect.promise(() => child.exited),
    (status) => {
      measured ??= runtimeCost(child);
      return { status, signal: child.signalCode ?? null };
    },
  );

  const sink = child.stdin;
  const writable = sink !== undefined && sink !== null && typeof sink !== 'number' ? sink : undefined;
  const written = Sink.forEach((chunk: Uint8Array) =>
    Effect.tryPromise({
      try: async () => {
        writable?.write(chunk);
        await writable?.flush();
      },
      catch: (cause) => failed('stdin', cause),
    }),
  );

  const handle = makeHandle({
    pid: ProcessId(child.pid),
    exitCode: Effect.flatMap(ended, ({ status, signal }) =>
      signal === null ? Effect.succeed(ExitCode(status)) : Effect.fail(signalled(signal)),
    ),
    isRunning: Effect.sync(() => !reaped()),
    kill: (killOptions) => Effect.asVoid(Effect.andThen(end(child, killOptions, leads), ended)),
    stdin:
      writable === undefined
        ? Sink.drain
        : endOnDone
          ? Sink.mapEffect(written, () =>
              Effect.tryPromise({
                try: async () => {
                  await writable.end();
                },
                catch: (cause) => failed('stdin', cause),
              }),
            )
          : written,
    stdout: bytes(child.stdout as ReadableStream<Uint8Array> | undefined, 'stdout'),
    stderr: bytes(child.stderr as ReadableStream<Uint8Array> | undefined, 'stderr'),
    all: Stream.merge(
      bytes(child.stdout as ReadableStream<Uint8Array> | undefined, 'stdout'),
      bytes(child.stderr as ReadableStream<Uint8Array> | undefined, 'stderr'),
    ),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.sync(() => {
      if (referenced) {
        child.unref();
        referenced = false;
      }
      return Effect.sync(() => {
        if (!referenced) {
          child.ref();
          referenced = true;
        }
      });
    }),
  });
  const input = options.stdin;
  if (Stream.isStream(input)) yield* Effect.forkScoped(Stream.run(input, handle.stdin));
  else if (typeof input === 'object' && Stream.isStream(input.stream)) yield* Effect.forkScoped(Stream.run(input.stream, handle.stdin));
  return Object.assign(handle, { [ProcessCostTypeId]: costOf }, leads ? { [ProcessGroupTypeId]: groupOf(child) } : {});
});

const end = Effect.fnUntraced(function* (child: Started, options: KillOptions | undefined, leads: boolean) {
  yield* deliver(child, options?.killSignal ?? 'SIGTERM', leads);
  const gone = (): Effect.Effect<void> =>
    Effect.suspend(() =>
      (child.exitCode !== null || child.signalCode !== null) && (!leads || !groupOf(child).standing())
        ? Effect.void
        : Effect.andThen(Effect.sleep('10 millis'), gone),
    );
  const left = yield* gone().pipe(Effect.timeoutOption(options?.forceKillAfter ?? '1 second'));
  if (left._tag === 'None' && options?.forceKillAfter !== undefined) yield* deliver(child, 'SIGKILL', leads);
  yield* Effect.promise(() => child.exited);
});

const deliver = (child: Started, signal: string, leads: boolean): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.try({
    try: () => {
      if (leads) {
        try {
          globalThis.process.kill(-child.pid, signal as NodeJS.Signals);
          return;
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
        }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill(signal as NodeJS.Signals);
    },
    catch: (cause) => failed('kill', cause),
  });

export const bunSpawner = (options: SpawnerOptions = {}): Layer.Layer<ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner,
    makeSpawner((command: Command) => spawn(command, options)),
  );
