import { Duration, Effect, Layer, PlatformError, Sink, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { executionId, killCommand } from './channel.js';
import { GUEST_PROGRAM, GUEST_REGISTER, GUEST_INTERPRETER, GUEST_SHELL, type Guest } from './layout.js';

function guestArgv(command: ChildProcess.StandardCommand): readonly string[] {
  const shell = command.options.shell;
  if (shell === undefined || shell === false) return [command.command, ...command.args];
  return [typeof shell === 'string' ? shell : GUEST_SHELL, '-c', command.command];
}

function guestEnv(env: Record<string, string | undefined> | undefined): Record<string, string | null> {
  const declared: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(env ?? {})) declared[name] = value ?? null;
  return declared;
}

const notSupported = (description: string): PlatformError.PlatformError =>
  PlatformError.badArgument({ module: 'ChildProcess', method: 'spawn', description });

export const GuestExec = (
  guest: Guest,
  host: ChildProcessSpawner.ChildProcessSpawner['Service'],
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> => {
  const endInGuest = Effect.fn('sandbox.endInGuest')(
    function* (id: string, signal: string) {
      const ending = yield* host.spawn(ChildProcess.make('docker', [...killCommand(guest, id, signal)], { stdin: 'ignore' }));
      yield* ending.exitCode;
    },
    Effect.scoped,
    Effect.catchCause(() => Effect.void),
  );

  const spawn = Effect.fn('sandbox.spawn')(function* (
    command: ChildProcess.Command,
  ): Effect.fn.Return<ChildProcessSpawner.ChildProcessHandle, PlatformError.PlatformError, import('effect').Scope.Scope> {
    if (command._tag === 'PipedCommand') {
      return yield* Effect.fail(
        notSupported('a guest runs one command; a pipeline belongs inside the shell line the guest shell is handed'),
      );
    }
    const id = executionId();
    const stdin = command.options.stdin;
    const silent = stdin === 'ignore';
    const request = {
      id,
      dir: GUEST_REGISTER,
      argv: guestArgv(command),
      env: guestEnv(command.options.env),
      extendEnv: command.options.extendEnv === true,
      stdin: silent ? 'ignore' : 'pipe',
      cwd: command.options.cwd,
    };
    const client = yield* host.spawn(
      ChildProcess.make(
        'docker',
        ['exec', ...(silent ? [] : ['-i']), guest.container, GUEST_INTERPRETER, GUEST_PROGRAM, 'exec', JSON.stringify(request)],
        {
          stdin,
          stdout: command.options.stdout,
          stderr: command.options.stderr,
        },
      ),
    );
    const end = (signal: string, force: Duration.Input | undefined): Effect.Effect<void> => {
      const signalled: Effect.Effect<void> = endInGuest(id, signal).pipe(Effect.andThen(Effect.ignore(client.exitCode)), Effect.asVoid);
      if (force === undefined) return signalled;
      return Effect.timeoutOrElse(signalled, {
        duration: force,
        orElse: (): Effect.Effect<void> => endInGuest(id, 'SIGKILL').pipe(Effect.andThen(Effect.ignore(client.exitCode)), Effect.asVoid),
      });
    };
    yield* Effect.addFinalizer(() =>
      client.isRunning.pipe(
        Effect.matchEffect({
          onFailure: () => end(command.options.killSignal ?? 'SIGTERM', command.options.forceKillAfter),
          onSuccess: (running) => (running ? end(command.options.killSignal ?? 'SIGTERM', command.options.forceKillAfter) : Effect.void),
        }),
      ),
    );
    return ChildProcessSpawner.makeHandle({
      pid: client.pid,
      exitCode: client.exitCode,
      isRunning: client.isRunning,
      kill: (options) => end(options?.killSignal ?? 'SIGTERM', options?.forceKillAfter),
      stdin: client.stdin,
      stdout: client.stdout,
      stderr: client.stderr,
      all: client.all,
      getInputFd: () => Sink.drain,
      getOutputFd: () => Stream.empty,
      unref: client.unref,
    });
  });

  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(spawn));
};
