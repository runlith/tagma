import { Effect, Queue } from 'effect';
import { EvidenceFeed, ThreadEvidence } from '../../../threads/contract/service/evidence.js';

export const settledThread = Effect.fnUntraced(
  function* ({ threadId, projectId, runId }: { threadId: string; projectId: number; runId?: string }) {
    const feed = yield* EvidenceFeed;
    const evidence = yield* ThreadEvidence;
    const changed = yield* Effect.acquireRelease(Queue.unbounded<void>(), Queue.shutdown);
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        feed.subscribe(threadId, (event) => {
          if (event.type === 'state') Queue.offerUnsafe(changed, undefined);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    for (;;) {
      const snapshot = yield* evidence.snapshot(threadId, projectId);
      const latest = snapshot.latestRun;
      if (snapshot.activeRun === null && latest !== null && (runId === undefined || latest.id === runId)) return snapshot;
      yield* Queue.take(changed);
    }
  },
  Effect.scoped,
  Effect.timeout('10 seconds'),
);
