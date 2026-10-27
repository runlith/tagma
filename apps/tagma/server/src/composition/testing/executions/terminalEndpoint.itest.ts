import { expect } from 'bun:test';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { layer } from '@runlith/effect-test';
import { Clock, Context, Effect, Layer, Queue, Schema } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import { TerminalWriting } from '../../../executions/contract/service/writing.js';
import { TerminalGrids } from '../../../executions/contract/service/views.js';
import { TerminalOperationReading } from '../../../executions/contract/wire/operationAnswers.js';
import { TerminalLaneOpened, ViewId, type TerminalDecider } from '../../../executions/contract/wire/viewLeases.js';
import { makePageWorld } from '../pageWorld.js';

const CLIENT = Bun.resolveSync('@runlith/execution-host/testing/laneClient', import.meta.dir);
const BLOCK_MS = 2000;
const ECHO_MS = 100;
const TYPIST = ViewId.make('endpoint-typist');
const WATCHER = ViewId.make('endpoint-watcher');
const TYPIST_BOX = { rows: 30, columns: 100 };
const WATCHER_BOX = { rows: 50, columns: 160 };

class Page extends Context.Service<Page, Effect.Success<ReturnType<typeof makePageWorld>>>()('testing/TerminalEndpoint') {}

type Measured = {
  readonly started: number;
  readonly finished: number;
  readonly command: number;
  readonly keys: ReadonlyArray<number>;
};

const typist = Effect.fnUntraced(function* (url: string, token: string, next: number) {
  const lines = yield* Queue.unbounded<string>();
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, CLIENT, url, token, String(next)], { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }),
    ),
    (spawned) =>
      Effect.promise(async () => {
        spawned.kill('SIGKILL');
        await spawned.exited;
      }),
  );
  yield* Effect.forkScoped(
    Effect.promise(async () => {
      const decoder = new TextDecoder();
      let held = '';
      for await (const chunk of child.stdout) {
        held += decoder.decode(chunk, { stream: true });
        for (let at = held.indexOf('\n'); at >= 0; at = held.indexOf('\n')) {
          Queue.offerUnsafe(lines, held.slice(0, at));
          held = held.slice(at + 1);
        }
      }
    }),
  );
  return { pid: child.pid, line: Effect.map(Queue.take(lines), (line) => JSON.parse(line) as Record<string, unknown>) };
});

const blocking = Effect.fnUntraced(function* (signalled: number) {
  process.kill(signalled, 'SIGUSR2');
  const from = yield* Clock.currentTimeMillis;
  yield* Effect.sync(() => {
    const until = performance.now() + BLOCK_MS;
    while (performance.now() < until);
  });
  return { from, to: yield* Clock.currentTimeMillis };
});

layer(Layer.effect(Page, makePageWorld()).pipe(Layer.provide(BunFileSystem.layer)), { excludeTestServices: true })(
  'terminal endpoint',
  (it) => {
    it.effect(
      'a key typed through a lane the server opened echoes within 100 ms while the server’s loop is blocked, and the host’s reports tell the server who typed and which view decides',
      () =>
        Effect.gen(function* () {
          const page = yield* Page;
          const started = yield* page
            .perform<unknown>('start_terminal', {
              operationId: 'terminal-endpoint-start',
              cwd: page.checkout,
              label: 'terminal-endpoint',
              program: '/bin/sh',
              transport: 'pty',
              lifetime: 'held',
              geometry: { rows: 24, columns: 80 },
            })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(TerminalOperationReading)));
          const operation = started.operation;
          if (operation._tag !== 'Whole' || operation.state._tag !== 'Settled' || operation.state.execution === undefined) {
            return yield* Effect.die(new Error(`no shell was started: ${JSON.stringify(started)}`));
          }
          const ref = operation.state.execution;
          const address = { execution: ref.execution, incarnation: ref.incarnation };
          yield* Effect.addFinalizer(() =>
            page.perform('stop_terminal', { ...address, operationId: 'terminal-endpoint-stop', cause: 'explicit-stop' }).pipe(Effect.orDie),
          );

          const decided = yield* Queue.unbounded<TerminalDecider>();
          const grids = Context.get(page.world.runtime.door, TerminalGrids);
          yield* grids.watch(ref, TYPIST, 1, TYPIST_BOX, (frame) => Queue.offerUnsafe(decided, frame));
          yield* grids.watch(ref, WATCHER, 2, WATCHER_BOX, () => undefined);

          const lane = yield* page
            .perform<unknown>('open_terminal_lane', { ...address, view: TYPIST })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(TerminalLaneOpened)));
          expect(lane.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/terminal$/u);

          const client = yield* typist(lane.url, lane.token, lane.next);
          expect(yield* client.line).toHaveProperty('ready');
          const blocked = yield* blocking(client.pid);
          const measured = (yield* client.line) as Measured;
          const said = JSON.stringify(measured);
          expect(measured.started, said).toBeGreaterThanOrEqual(blocked.from);
          expect(measured.finished, said).toBeLessThanOrEqual(blocked.to);
          expect(measured.command, said).toBeLessThan(ECHO_MS);
          expect(Math.max(...measured.keys), said).toBeLessThan(ECHO_MS);

          const frame = yield* Effect.repeat(Queue.take(decided), { until: (heard) => heard.decider === TYPIST });
          expect(frame).toEqual({ decider: TYPIST, applied: TYPIST_BOX });
          const typedBy = yield* Context.get(page.world.runtime.door, TerminalWriting).typedBy(ref, null);
          expect(typedBy.map((typed) => typed.writer)).toEqual([Principal.make('operator')]);
        }),
    );
  },
);
