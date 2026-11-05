import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { NATIVE_BINDING } from '../../record';
import { fakeAdapter } from '../fakeTransport';
import type { ThreadStorageFactory } from '../storagePort';
import { describeTransportRuns, type RunsHarness } from '../transportRuns';
import { gate, until } from './support';
import { hangingTurn } from './scripts';
import { OWNER, openedRun, SCOPE, startedTurn } from './world';
const REFUSING = { adapter: 'refusing', profile: null, agent: null } as const;
export function describeNativeLaunches<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeTransportRuns(`${name}: the native adapter`, () => nativeRuns(open), test);
  describe(`${name}: the scheduler hands each run to its transport`, () => {
    test(
      'two refused launches in a row stop the wake and keep the words queued, and a word from the person tries again',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open, { rhythm: { heartbeatIntervalMs: 5 } });
        const adapter = fakeAdapter('refusing');
        adapter.refusing = true;
        yield* world.harness.runs.transports().register(adapter.transport);
        yield* storage.aggregate.update(thread.id, { transport: REFUSING });
        const observer = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const failedRuns = () => Effect.map(observer.runsOf(thread.id), (runs) => runs.filter((run) => run.status === 'failed'));
        yield* world.harness.inputs.deliver(thread.id, OWNER, {
          id: 'envelope:note',
          senderThreadId: null,
          intent: 'message',
          text: 'A note.',
        });
        yield* until(() => Effect.map(failedRuns(), (runs) => runs.length >= 2));
        yield* Effect.sleep(20);
        expect(adapter.launches).toHaveLength(2);
        expect(yield* failedRuns()).toHaveLength(2);
        expect((yield* storage.inbox.pending(thread.id)).map((item) => [item.id, item.state])).toEqual([['envelope:note', 'queued']]);
        yield* world.harness.threads.handle(thread.id, OWNER).send('Try once more.');
        yield* until(() => Effect.sync(() => adapter.launches.length >= 3));
      }),
    );
    test(
      'a run handed to an adapter is beaten from the first tick, before the adapter has written anything',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open, { rhythm: { heartbeatIntervalMs: 5 } });
        const adapter = fakeAdapter('holding');
        yield* world.harness.runs.transports().register(adapter.transport);
        yield* storage.aggregate.update(thread.id, { transport: { adapter: 'holding', profile: null, agent: null } });
        const observer = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const said = yield* startedTurn(world, thread.id, 'Begin.');
        yield* until(() => Effect.sync(() => adapter.launches.length === 1));
        const opened = (yield* observer.runById(said.runId))!;
        yield* until(() =>
          Effect.map(observer.runById(said.runId), (run) => (run?.heartbeatAt.getTime() ?? 0) > opened.heartbeatAt.getTime()),
        );
        expect(adapter.transport.runs.holds([said.runId])).toEqual([said.runId]);
      }),
    );
  });
}
const nativeRuns = Effect.fnUntraced(function* <TTx, TWrite extends TTx, R>(open: ThreadStorageFactory<TTx, TWrite, R>) {
  const { storage, world, thread } = yield* openedRun(open);
  const going = gate();
  world.plan.push(hangingTurn({ chunks: [{ type: 'text-start', id: 'r1' }], reached: going.reach }));
  const transport = yield* world.harness.runs.transports().of({ transport: NATIVE_BINDING });
  yield* Effect.addFinalizer(() => Effect.orDie(world.harness.threads.handle(thread.id, OWNER).stop()));
  return {
    transport,
    start: Effect.fnUntraced(function* () {
      const turn = yield* startedTurn(world, thread.id, 'Hold on.');
      yield* going.reached;
      const row = (yield* storage.aggregate.find(thread.id))!;
      const run = (yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runById(turn.runId))!;
      return { thread: row, run };
    }),
    sent: () => world.ranWith.length,
  } satisfies RunsHarness;
});
