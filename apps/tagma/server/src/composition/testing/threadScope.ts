import { Context, Effect } from 'effect';
import { Projects } from '../../projects/contract/service/registry.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { turnsOf } from '../../threads/testing/doubles.js';
import type { DoorFixture } from './doorFixture.js';

export const holdThreads = Effect.fnUntraced(function* (world: DoorFixture['Service']) {
  const born: { readonly threadId: string; readonly projectId: number }[] = [];
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      Context.get(world.runtime.owners, ThreadRecords).birthRecorded((thread) =>
        Effect.sync(() => {
          born.push(thread);
        }),
      ),
    ),
    (stop) =>
      Effect.gen(function* () {
        stop();
        const removed = new Set(yield* Context.get(world.runtime.owners, Projects).removed().pipe(Effect.orDie));
        const standing = born.filter((thread) => !removed.has(thread.projectId)).reverse();
        yield* Effect.forEach(standing, ({ threadId, projectId }) => turnsOf(world.runtime.owners).stop(threadId, projectId), {
          discard: true,
        }).pipe(Effect.orDie);
      }),
  );
});
