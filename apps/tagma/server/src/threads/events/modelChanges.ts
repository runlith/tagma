import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { ModelChanges, type ModelChange } from '../contract/service/modelChanges.js';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import { thread } from '../store/kernel.js';

export const makeModelChanges = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  let hearing: ((threadId: string, change: ModelChange) => Effect.Effect<void, ThreadBorderFailed>) | null = null;
  return ModelChanges.of({
    record: Effect.fn('ModelChanges.record')(function* (unit, threadId, patch, write) {
      if (patch.provider === undefined && patch.model === undefined && patch.reasoning === undefined) return yield* write;
      const from = yield* unit.run(
        db
          .select({ provider: thread.provider, model: thread.model, reasoning: thread.reasoning })
          .from(thread)
          .where(eq(thread.id, threadId))
          .get(),
      );
      const result = yield* write;
      if (from === undefined) return result;
      const to = {
        provider: patch.provider ?? from.provider,
        model: patch.model === undefined ? from.model : patch.model,
        reasoning: patch.reasoning === undefined ? from.reasoning : patch.reasoning,
      };
      if (from.provider === to.provider && from.model === to.model && from.reasoning === to.reasoning) return result;
      const change: ModelChange = { id: crypto.randomUUID(), from, to };
      yield* unit.afterCommit(Effect.suspend(() => (hearing === null ? Effect.void : Effect.orDie(hearing(threadId, change)))));
      return result;
    }),
    follow: (heard) => {
      if (hearing !== null) throw new Error('The thread event owner already follows model changes.');
      hearing = heard;
      return () => {
        if (hearing === heard) hearing = null;
      };
    },
  });
});
