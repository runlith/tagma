import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Duration, Effect, Fiber, type Scope, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { CommandOptions } from 'effect/process/ChildProcess';
import { processCost, bunSpawner } from '@runlith/executions/bunSpawner';

type Needs = ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;

const FORCE_MS = 200;

layer(bunSpawner(), { excludeTestServices: true })('the runtime spawner', (it) => {
  it.effect('a child of this process answers what it cost, and the figure tracks work rather than elapsed time', () =>
    Effect.gen(function* () {
      const of = Effect.fnUntraced(function* (line: string) {
        const handle = yield* ChildProcess.make('/bin/sh', ['-c', line], { stdin: 'ignore' });
        yield* Effect.forkScoped(Stream.runDrain(handle.stdout));
        const started = performance.now();
        yield* handle.exitCode;
        return { cost: processCost(handle), wallMs: performance.now() - started };
      }, Effect.scoped);
      const readings = { burner: yield* of('yes | head -c 20000000 > /dev/null'), idler: yield* of('sleep 1') };

      expect(readings.burner.cost?._tag).toBe('Measured');
      expect(readings.idler.cost?._tag).toBe('Measured');
      if (readings.burner.cost?._tag !== 'Measured' || readings.idler.cost?._tag !== 'Measured') return;
      expect(readings.burner.cost.cpuMicros).toBeGreaterThan(readings.idler.cost.cpuMicros * 2);
      expect(readings.burner.wallMs).toBeLessThan(readings.idler.wallMs);
      expect(readings.burner.cost.peakRssBytes).toBeGreaterThan(0);
    }),
  );

  it.effect('a signal death fails the exit code naming the signal, and the cost is still measured', () =>
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('/bin/sh', ['-c', 'kill -QUIT $$'], { stdin: 'ignore' });
      yield* Effect.forkScoped(Stream.runDrain(handle.stdout));
      const outcome = yield* Effect.result(handle.exitCode);

      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') {
        expect(String((outcome.failure as { message?: string }).message)).toContain('SIGQUIT');
      }
      expect(processCost(handle)?._tag).toBe('Measured');
    }),
  );

  it.effect('kill escalates to SIGKILL after its force budget, and answers once the child is gone', () =>
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('/bin/sh', ['-c', 'trap "" TERM; echo ready; while :; do sleep 30; done'], {
        stdin: 'ignore',
        detached: true,
      });
      const waiting = yield* Effect.forkScoped(Effect.result(handle.exitCode));
      yield* Stream.runHead(handle.stdout);
      yield* handle.kill({ killSignal: 'SIGTERM', forceKillAfter: Duration.millis(FORCE_MS) });
      const running = yield* handle.isRunning;
      const outcome = yield* Fiber.join(waiting);

      expect(running).toBe(false);
      expect(outcome._tag).toBe('Failure');
      if (outcome._tag === 'Failure') {
        expect(String((outcome.failure as { message?: string }).message)).toContain('SIGKILL');
      }
    }),
  );

  it.effect('a piped stdin closes when its writer is done, and stays open when the caller says not to', () =>
    Effect.gen(function* () {
      const echoed = yield* Effect.gen(function* () {
        const handle = yield* ChildProcess.make('/bin/cat', [], { stdin: 'pipe' });
        const collected = yield* Effect.forkScoped(Stream.runCollect(handle.stdout));
        yield* Stream.run(Stream.make(new TextEncoder().encode('hello')), handle.stdin);
        const code = yield* handle.exitCode;
        const chunks = yield* Fiber.join(collected);
        return { code, text: chunks.map((chunk) => new TextDecoder().decode(chunk)).join('') };
      }).pipe(Effect.scoped);
      expect(Number(echoed.code)).toBe(0);
      expect(echoed.text).toBe('hello');

      const handle = yield* ChildProcess.make('/bin/cat', [], {
        stdin: { stream: 'pipe', endOnDone: false },
        detached: true,
      });
      yield* Effect.forkScoped(Stream.runDrain(handle.stdout));
      yield* Stream.run(Stream.make(new TextEncoder().encode('hello')), handle.stdin);
      const held = yield* handle.isRunning;
      yield* handle.kill({ killSignal: 'SIGKILL' });
      expect(held).toBe(true);
    }),
  );

  it.effect('the environment is inherited, set and unset exactly as a caller named it', () =>
    Effect.gen(function* () {
      const previous = process.env.RUNLITH_PROBE;
      process.env.RUNLITH_PROBE = 'inherited';
      const of = Effect.fnUntraced(function* (options: CommandOptions) {
        const handle = yield* ChildProcess.make('/bin/sh', ['-c', 'printf "%s" "${RUNLITH_PROBE:-none}"'], options);
        return yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString);
      }, Effect.scoped);
      const said = yield* Effect.gen(function* () {
        return {
          bare: yield* of({ stdin: 'ignore' }),
          set: yield* of({ stdin: 'ignore', env: { RUNLITH_PROBE: 'named' }, extendEnv: true }),
          unset: yield* of({ stdin: 'ignore', env: { RUNLITH_PROBE: undefined }, extendEnv: true }),
          only: yield* of({ stdin: 'ignore', env: { OTHER: 'x' } }),
        };
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete process.env.RUNLITH_PROBE;
            else process.env.RUNLITH_PROBE = previous;
          }),
        ),
      );

      expect(said.bare).toBe('inherited');
      expect(said.set).toBe('named');
      expect(said.unset).toBe('none');
      expect(said.only).toBe('none');
    }),
  );

  it.effect('what this spawner cannot arrange it refuses, rather than answering something similar', () =>
    Effect.gen(function* () {
      const of = (make: Effect.Effect<unknown, unknown, Needs>) =>
        Effect.map(Effect.result(make), (outcome) =>
          outcome._tag === 'Failure' ? String((outcome.failure as { message?: string }).message) : 'accepted',
        );
      const refusals = {
        shell: yield* of(ChildProcess.make('/bin/echo', ['hi'], { shell: true })),
        fds: yield* of(ChildProcess.make('/bin/echo', ['x'], { additionalFds: { fd3: { type: 'output' } } })),
      };

      expect(refusals.shell).toContain('must name its shell as the program it runs');
      expect(refusals.fds).toContain('additional file descriptors');
    }),
  );
});
