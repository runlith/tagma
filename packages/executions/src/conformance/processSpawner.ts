import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Deferred, Effect, Fiber, type Layer, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

export const processConformance = (name: string, spawner: Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>) => {
  layer(spawner, { excludeTestServices: true })(name, (it) => {
    it.effect('a streamed input closes stdin and preserves both output streams and the exit status', () =>
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make('/bin/sh', ['-c', 'cat; printf diagnostic >&2; exit 17'], {
          stdin: Stream.make(new TextEncoder().encode('payload')),
        });
        const output = yield* Effect.forkScoped(Stream.mkString(Stream.decodeText(handle.stdout)));
        const errors = yield* Effect.forkScoped(Stream.mkString(Stream.decodeText(handle.stderr)));
        expect(Number(yield* handle.exitCode)).toBe(17);
        expect(yield* Fiber.join(output)).toBe('payload');
        expect(yield* Fiber.join(errors)).toBe('diagnostic');
        expect(yield* handle.isRunning).toBe(false);
      }),
    );

    it.effect('a failed leader releases descendant pipes even after unref and before its scope closes', () =>
      Effect.gen(function* () {
        const ready = yield* Deferred.make<string>();
        const handle = yield* ChildProcess.make('/bin/sh', ['-c', 'sleep 60 & printf "%s\\n" "$!"; read line; exit 17']);
        yield* handle.unref;
        const output = yield* Effect.forkScoped(
          Stream.mkString(Stream.tap(Stream.decodeText(handle.stdout), (chunk) => Deferred.succeed(ready, chunk))),
        );
        const errors = yield* Effect.forkScoped(Stream.runDrain(handle.stderr));
        const started = yield* Deferred.await(ready);
        yield* Stream.run(Stream.make(new TextEncoder().encode('exit\n')), handle.stdin);
        expect(Number(yield* handle.exitCode)).toBe(17);
        expect(yield* Fiber.join(output)).toBe(started);
        yield* Fiber.join(errors);
      }),
    );

    it.effect('a pipeline feeds the next process and returns its output and exit', () =>
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make('/bin/echo', ['lower'], { stdin: 'ignore' }).pipe(
          ChildProcess.pipeTo(ChildProcess.make('/usr/bin/tr', ['a-z', 'A-Z'], { stdin: 'ignore' })),
        );
        expect(yield* Stream.mkString(Stream.decodeText(handle.stdout))).toBe('LOWER\n');
        expect(Number(yield* handle.exitCode)).toBe(0);
      }),
    );

    it.effect('a signal is a typed exit failure and a referenced child ends with its scope', () =>
      Effect.gen(function* () {
        const signalled = yield* ChildProcess.make('/bin/cat');
        expect(yield* signalled.isRunning).toBe(true);
        yield* signalled.kill({ killSignal: 'SIGTERM' });
        const failure = yield* Effect.flip(signalled.exitCode);
        expect(failure._tag).toBe('PlatformError');
        expect(failure.reason.method).toBe('exitCode');
        expect(yield* signalled.isRunning).toBe(false);
        const scoped = yield* Effect.scoped(ChildProcess.make('/bin/cat'));
        expect(yield* scoped.isRunning).toBe(false);
      }),
    );
  });
};
