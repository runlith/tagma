import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { Clock, Deferred, Effect, type Scope } from 'effect';
import { ThreadRunConflict } from '../../collaboration/runs';
import { processTurn } from './runLog/scripts';
import { until } from './runLog/support';
import { scriptedWorld } from './runLog/world';
import type { ThreadStorageFactory } from './storagePort';
const OWNER = 'owner';
const SCOPE = 'scope-a';
const TASK = 'Hold the turn until stopped';
export function describeThreadRunStop<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: keyed run stop`, () => {
    test(
      'a stop replayed under its key answers the first outcome and touches no newer run; the key under another payload conflicts',
      Effect.fnUntraced(function* () {
        const stack = yield* openedStop(open);
        const { world, storage, child, first, settledRuns } = stack;
        const request = { key: 'stop-1', deadline: new Date((yield* Clock.currentTimeMillis) + 60_000) };
        expect(yield* world.runs().stop(child, { request, expected: first, by: 'parent' })).toEqual({ status: 'stopped', acted: true });
        yield* settledRuns(first);
        expect(yield* stack.status(first)).toBe('aborted');
        world.plan.push(processTurn(Effect.never));
        const said = yield* world.harness.threads.handle(child, OWNER).send('Again.');
        if (!('runId' in said)) return yield* Effect.die('The second turn did not open a run.');
        const second = said.runId;
        expect(second).not.toBe(first);
        expect(yield* world.runs().stop(child, { request, expected: first, by: 'parent' })).toEqual({ status: 'stopped', acted: false });
        expect(yield* stack.status(second)).toBe('running');
        const reused = yield* Effect.flip(world.runs().stop(child, { request, expected: second, by: 'parent' }));
        expect(reused).toBeInstanceOf(ThreadRunConflict);
        expect(reused).toMatchObject({ reason: 'act-id-reused' });
        expect(yield* stack.status(second)).toBe('running');
        expect((yield* storage.runs({ ownerId: OWNER, scope: SCOPE }).latestRun(child))?.id).toBe(second);
      }),
    );
    test(
      'a stop that names no run keeps the run it first found: its replay interrupts no newer run, and another payload under the key conflicts',
      Effect.fnUntraced(function* () {
        const stack = yield* openedStop(open);
        const { world, child, first, settledRuns } = stack;
        const request = { key: 'stop-2', deadline: new Date((yield* Clock.currentTimeMillis) + 60_000) };
        expect(yield* world.runs().stop(child, { request, by: 'parent' })).toEqual({ status: 'stopped', acted: true });
        yield* settledRuns(first);
        const second = yield* stack.reopened();
        expect(yield* world.runs().stop(child, { request, by: 'parent' })).toEqual({ status: 'stopped', acted: false });
        expect(yield* stack.status(second)).toBe('running');
        expect(yield* Effect.flip(world.runs().stop(child, { request, by: 'agent' }))).toBeInstanceOf(ThreadRunConflict);
        expect(yield* Effect.flip(world.runs().stop(child, { request, expected: second, by: 'parent' }))).toBeInstanceOf(ThreadRunConflict);
        expect(yield* stack.status(second)).toBe('running');
      }),
    );
    test(
      'a parent’s stop tool retried under its call id after the run ended answers the first outcome and leaves the next run going',
      Effect.fnUntraced(function* () {
        const stack = yield* openedStop(open);
        const { world, parent, child, first, settledRuns } = stack;
        const stop = (key: string) =>
          world.harness.collaboration.collaborate(parent, OWNER, (verbs) => verbs.stop({ threadId: child, key, asked: [] }));
        expect((yield* stop('tool-1')).status).toBe('stopped');
        yield* settledRuns(first);
        const second = yield* stack.reopened();
        expect((yield* stop('tool-1')).status).toBe('stopped');
        expect(yield* stack.status(second)).toBe('running');
        expect((yield* stop('tool-2')).status).toBe('stopped');
        yield* settledRuns(second);
        expect(yield* stack.status(second)).toBe('aborted');
      }),
    );
    test(
      'an interrupt delivered again from the snapshot it was accepted with stops nothing once a run has read it',
      Effect.fnUntraced(function* () {
        const stack = yield* openedStop(open);
        const { world, storage, parent, child, first, settledRuns } = stack;
        const runs = storage.runs({ ownerId: OWNER, scope: SCOPE });
        const now = yield* Clock.currentTimeMillis;
        const { item } = yield* storage.inbox.put({
          id: 'interrupt-1',
          threadId: child,
          sender: { kind: 'thread', threadId: parent, name: null },
          kind: 'task',
          body: { intent: 'interrupt', text: 'Drop it and report.', inReplyTo: null },
          occurredAt: new Date(now).toISOString(),
        });
        const deliver = () => world.runs().deliver(child, { item, deadline: new Date(now + 60_000) });
        world.plan.push(processTurn(Effect.never));
        expect(yield* deliver()).toMatchObject({ status: 'queued', runId: first, acted: true });
        yield* settledRuns(first);
        yield* until(() => Effect.map(storage.inbox.receipt('interrupt-1'), (receipt) => receipt?.state === 'delivered'));
        const successor = (yield* runs.latestRun(child))!.id;
        expect(yield* deliver()).toEqual({ status: 'queued', runId: successor, acted: false });
        expect(yield* stack.status(successor)).toBe('running');
      }),
    );
  });
}
const openedStop = Effect.fnUntraced(function* <TTx, TWrite extends TTx = TTx, R = never>(open: ThreadStorageFactory<TTx, TWrite, R>) {
  const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
  const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
  const waiting = new Map<string, Deferred.Deferred<void>>();
  const waiter = (runId: string) => {
    const standing = waiting.get(runId);
    if (standing) return standing;
    const made = Deferred.makeUnsafe<void>();
    waiting.set(runId, made);
    return made;
  };
  const world = yield* scriptedWorld(storage, thread.agentId, {
    models: modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS),
    onSettled: (event) => Effect.asVoid(Deferred.succeed(waiter(event.runId), undefined)),
  });
  world.plan.push(processTurn(Effect.never));
  const child = yield* world.harness.collaboration.spawn({
    parentThreadId: thread.id,
    ownerId: OWNER,
    requestId: 'call-1',
    agentId: thread.agentId,
    task: TASK,
  });
  const first = (yield* storage.runs({ ownerId: OWNER, scope: SCOPE }).latestRun(child.threadId))!.id;
  return {
    world,
    storage,
    parent: thread.id,
    child: child.threadId,
    first,
    reopened: Effect.fnUntraced(function* () {
      world.plan.push(processTurn(Effect.never));
      const said = yield* world.harness.threads.handle(child.threadId, OWNER).send('Again.');
      if (!('runId' in said)) return yield* Effect.die('The next turn did not open a run.');
      return said.runId;
    }),
    settledRuns: (runId: string) => Deferred.await(waiter(runId)),
    status: (runId: string) => Effect.map(storage.runs({ ownerId: OWNER, scope: SCOPE }).runById(runId), (row) => row?.status),
  };
});
