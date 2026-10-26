import { type Cause, Deferred, type Duration, Effect, Exit, Queue, type Scope, Stream } from 'effect';
import { ChildProcess, type ChildProcessSpawner } from 'effect/process';
import { Channel } from './channel.ts';
import { EngineUnavailable } from './failures.ts';
import { decodeLine } from './wire.ts';

export type EnginePaths = {
  readonly engine: string;
  readonly silero: string;
};

const inboxFrames = 64;

const exitReason = (exit: Exit.Exit<number, unknown>): string =>
  Exit.isSuccess(exit) ? `it exited with status ${exit.value}` : 'it was ended by a signal';

export const spawn = Effect.fn('Engine.spawn')(function* (
  paths: EnginePaths,
  within: Duration.Input,
): Effect.fn.Return<Channel, EngineUnavailable, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> {
  const inbox = yield* Queue.bounded<Uint8Array, Cause.Done>(inboxFrames);
  const channel = new Channel(inbox);
  const handle = yield* ChildProcess.make(paths.engine, ['--silero', paths.silero], {
    stdin: { stream: Stream.fromQueue(inbox), endOnDone: true },
    stdout: 'pipe',
    stderr: 'pipe',
  }).pipe(Effect.mapError((failure) => new EngineUnavailable({ reason: failure.message })));

  const read = Stream.splitLines(Stream.decodeText(handle.stdout)).pipe(
    Stream.runForEach((line) =>
      line === ''
        ? Effect.void
        : Effect.matchEffect(decodeLine(line), {
            onFailure: (failure) => channel.end(`it wrote an unreadable line: ${failure.message}`),
            onSuccess: (message) => channel.route(message),
          }),
    ),
  );
  const told = Stream.decodeText(handle.stderr).pipe(Stream.runForEach((text) => Effect.sync(() => channel.heard(text))));

  yield* Effect.forkScoped(Effect.exit(told));
  yield* Effect.forkScoped(Effect.andThen(Effect.exit(read), channel.end('its output closed')));
  yield* Effect.forkScoped(Effect.flatMap(Effect.exit(handle.exitCode), (exit) => channel.end(exitReason(exit))));
  yield* Effect.addFinalizer(() => channel.end('it was stopped'));

  yield* Deferred.await(channel.ready).pipe(
    Effect.timeoutOrElse({
      duration: within,
      orElse: () => Effect.andThen(channel.end('it did not report ready in time'), Deferred.await(channel.ready)),
    }),
    Effect.mapError((failure) => new EngineUnavailable({ reason: failure.message })),
  );
  return channel;
});
