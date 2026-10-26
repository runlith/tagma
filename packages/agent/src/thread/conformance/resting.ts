import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { OWNER, SCOPE, hold, opened, quiet, started, until } from './compactionWorld';
import { queuedIdOf } from './compactionRequests/support';
import type { ThreadStorageFactory } from './storagePort';
export function describeThreadResting<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a resting thread`, () => {
    test(
      'a run settling after the thread went to rest leaves its queued words queued and names why, and a reader word opens one run over them and itself',
      Effect.fnUntraced(function* () {
        const resting = new Set<string>();
        const stack = yield* opened(open, { resting });
        const { world, threadId, handle } = stack;
        const running = hold();
        world.answers.push({ text: 'First.', held: running }, { text: 'Both.' });
        yield* started(stack.handle, 'Begin.');
        yield* running.reached;
        const queued = queuedIdOf(yield* handle.queue('Queued behind the turn.'));
        resting.add(threadId);
        running.release();
        yield* quiet(world, threadId);
        expect(world.requests).toHaveLength(1);
        const waiting = yield* world.harness.reads.snapshot(threadId);
        expect(waiting.pendingInput.queued.map((row) => row.id)).toEqual([queued]);
        expect(waiting.status.wordsWait).toBe('archived');
        resting.delete(threadId);
        yield* handle.send('A reader word.');
        yield* until(() => Effect.sync(() => world.requests.length === 2));
        yield* quiet(world, threadId);
        expect(JSON.stringify(world.requests.at(-1))).toContain('Queued behind the turn.\\nA reader word.');
        const after = yield* world.harness.reads.snapshot(threadId);
        expect(after.pendingInput.queued).toEqual([]);
        expect(after.status.wordsWait).toBeUndefined();
      }),
    );
    test(
      'a message or a task a peer sends to a resting idle thread is stored without opening a run',
      Effect.fnUntraced(function* () {
        const resting = new Set<string>();
        const { storage, world, threadId } = yield* opened(open, { resting });
        const peer = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        resting.add(threadId);
        const note = yield* world.harness.inputs.deliver(threadId, OWNER, {
          id: 'envelope:peer-note',
          senderThreadId: peer.id,
          intent: 'message',
          text: 'A note.',
        });
        const task = yield* world.harness.inputs.deliver(threadId, OWNER, {
          id: 'envelope:peer-task',
          senderThreadId: peer.id,
          intent: 'task',
          text: 'A task.',
        });
        expect([note.status, task.status]).toEqual(['stored', 'stored']);
        expect(world.requests).toHaveLength(0);
        expect((yield* world.harness.reads.snapshot(threadId)).activeRun).toBeNull();
      }),
    );
  });
}
