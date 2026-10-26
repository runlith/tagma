import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { Duration, Effect, Fiber } from 'effect';
import { hangingTurn, heldTurn } from '@runlith/agent/thread/conformance/runLog/scripts';
import { gate } from '@runlith/agent/thread/conformance/runLog/support';
import { OWNER, SCOPE, openedRun, pump, startedTurn } from '@runlith/agent/thread/conformance/runLog/world';
import { threadCauseOf } from '@runlith/agent/thread/ThreadBorder';
import { ThreadDeleteStillSettlingError } from '@runlith/agent/thread/storage/aggregate';
import { fileThreadStorage, openFileThreadStorage } from '../fileStorage.js';

layer(fileThreadStorage, { excludeTestServices: true })('SQLite stops and withdrawal', (it) => {
  it.effect('a subtree delete whose run will not settle refuses before any row goes, and deletes the whole tree once it settles', () =>
    Effect.gen(function* () {
      const { storage, world, thread } = yield* openedRun(openFileThreadStorage);
      const child = yield* storage.aggregate.transaction((tx) =>
        storage.aggregate.insertChild(thread.id, { ownerId: OWNER, agentId: thread.agentId }, tx),
      );
      const held = gate();
      world.plan.push(hangingTurn({ chunks: [{ type: 'text-start', id: 'h1' }], reached: held.reach, onAbort: () => held.released }));
      const pumping = yield* Effect.forkScoped(pump(yield* startedTurn(world, thread.id, 'Start something long.')));
      yield* held.reached;
      const refused = yield* Effect.flip(world.harness.threads.handle(thread.id, OWNER).delete(Duration.millis(50)));
      expect(threadCauseOf(refused)).toBeInstanceOf(ThreadDeleteStillSettlingError);
      expect(yield* storage.aggregate.find(thread.id)).toBeDefined();
      expect(yield* storage.aggregate.find(child.id)).toBeDefined();
      held.release();
      yield* Fiber.join(pumping);
      expect(yield* world.harness.threads.handle(thread.id, OWNER).delete()).toBe(true);
      expect(yield* storage.aggregate.find(thread.id)).toBeUndefined();
      expect(yield* storage.aggregate.find(child.id)).toBeUndefined();
    }),
  );

  it.effect('a delete after a finished run waits for the work its run still does before any row goes', () =>
    Effect.gen(function* () {
      const settling = gate();
      const { storage, world, thread } = yield* openedRun(openFileThreadStorage, {
        onSettled: () => Effect.andThen(Effect.sync(settling.reach), settling.released),
      });
      yield* Effect.addFinalizer(() => Effect.sync(settling.release));
      world.plan.push(heldTurn(Effect.void));
      const turn = yield* startedTurn(world, thread.id, 'Answer and finish.');
      yield* settling.reached;
      expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id))?.status).toBe('completed');
      const refused = yield* Effect.flip(world.harness.threads.handle(thread.id, OWNER).delete(Duration.millis(50)));
      expect(threadCauseOf(refused)).toMatchObject({ _tag: 'ThreadDeleteStillSettling', threadId: thread.id, runId: turn.runId });
      expect(yield* storage.aggregate.find(thread.id)).toBeDefined();
      settling.release();
      expect(yield* world.harness.threads.handle(thread.id, OWNER).delete()).toBe(true);
      expect(yield* storage.aggregate.find(thread.id)).toBeUndefined();
    }),
  );
});
