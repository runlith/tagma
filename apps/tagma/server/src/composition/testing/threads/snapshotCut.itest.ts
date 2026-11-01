import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import { eq } from 'drizzle-orm';
import { Clock, Context, Deferred, Effect, Fiber, Queue } from 'effect';
import { join } from 'node:path';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { threadRecord } from '../../../thread-record/testing/doubles.js';
import { threadBase, threadInbox } from '../../../threads/testing/doubles.js';
import { ProtocolRig, protocolFixture, scenario } from './protocolRig.js';

layer(protocolFixture('snapshot-cut', 1), { excludeTestServices: true })('thread snapshot cut', (it) => {
  it.effect('a snapshot and publication keep host facts on their reader while later commits proceed', () =>
    Effect.gen(function* () {
      const rig = yield* ProtocolRig;
      const threadId = 'thread-opening-title-cut';
      const source = 'thread-attachment-source';
      const attachment = '00000000-0000-0000-0000-000000000001.md';
      for (const id of [threadId, source]) yield* rig.openThread(id, { name: 'claude-code', hosts: 'tagma' });
      const folder = join(rig.world.checkout, '.pictures', source);
      yield* rig.files.makeDirectory(folder, { recursive: true });
      yield* rig.files.writeFileString(join(folder, attachment), '# inherited');
      const db = Context.get(rig.world.context, MachineStore).db;
      yield* db.update(threadRecord()).set({ title: 'before' }).where(eq(threadRecord().id, threadId));
      yield* db
        .insert(threadBase())
        .values({
          threadId,
          depth: 0,
          sourceId: source,
          lowOrd: 1,
          highOrd: 0,
          afterPosition: 0,
          throughPosition: 0,
          prompts: 'kept',
          hidden: [],
        });
      yield* db
        .insert(threadInbox())
        .values({
          id: 'attached-signal',
          threadId,
          sender: { kind: 'host' },
          kind: 'signal',
          body: { type: 'notice', addressee: 'transport', text: 'attached', attachments: [{ id: attachment }] },
          occurredAt: new Date(yield* Clock.currentTimeMillis),
        });
      yield* scenario(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const released = yield* Deferred.make<void>();
          let pause: { entered: typeof entered; released: typeof released; skip: number } | undefined;
          const floor = yield* rig.floor([], {
            fails: 0,
            refuses: false,
            runs: (runs) => ({
              ...runs,
              latestRun: (id, statuses, tx) => {
                if (pause === undefined || id !== threadId || tx === undefined) return runs.latestRun(id, statuses, tx);
                if (pause.skip > 0) {
                  pause.skip -= 1;
                  return runs.latestRun(id, statuses, tx);
                }
                const waiting = pause;
                pause = undefined;
                return Effect.andThen(
                  Deferred.succeed(waiting.entered, undefined),
                  Effect.andThen(Deferred.await(waiting.released), runs.latestRun(id, statuses, tx)),
                );
              },
            }),
          });
          yield* floor.driver('title-cut-owner');
          pause = { entered, released, skip: 0 };
          const opening = yield* Effect.forkScoped(floor.harness.reads.snapshot(threadId), { startImmediately: true });
          yield* Deferred.await(entered);
          yield* db.update(threadRecord()).set({ title: 'after' }).where(eq(threadRecord().id, threadId));
          yield* Deferred.succeed(released, undefined);
          const first = yield* Fiber.join(opening);
          expect(first.title).toBe('before');
          expect(first.pendingInput.arrived?.[0]?.attachments?.[0]?.filename).toBe('inherited');
          const next = yield* floor.harness.reads.snapshot(threadId);
          expect(next.title).toBe('after');
          expect(next.pendingInput.arrived?.[0]?.attachments?.[0]?.filename).toBe('inherited');
          const frames = yield* Queue.unbounded<string>();
          const unsubscribe = floor.harness.reads.subscribeStates((state) => {
            if (state.thread.id === threadId) Queue.offerUnsafe(frames, state.title);
          });
          yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
          yield* floor.harness.threads.publish(threadId);
          expect(yield* Queue.take(frames)).toBe('after');
          expect((yield* floor.harness.reads.attachFrom(threadId, 0))?.state.title).toBe('after');
          const changing = yield* Deferred.make<void>();
          const changed = yield* Deferred.make<void>();
          pause = { entered: changing, released: changed, skip: 2 };
          const result = yield* Effect.forkScoped(floor.harness.threads.handle(threadId, 'operator').setAuthorityMode('trust'), {
            startImmediately: true,
          });
          yield* Deferred.await(changing);
          yield* db.update(threadRecord()).set({ title: 'newest' }).where(eq(threadRecord().id, threadId));
          yield* Deferred.succeed(changed, undefined);
          expect((yield* Fiber.join(result)).title).toBe('after');
          expect((yield* floor.harness.reads.snapshot(threadId)).title).toBe('newest');
        }),
      );
    }),
  );
});
