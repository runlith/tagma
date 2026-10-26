import { Clock, Effect } from 'effect';
import { sql } from 'drizzle-orm';
import type { StoreDb } from '../../../platform/contract/service/store.js';
import { threadEntry, threadRun } from '../../../threads/testing/doubles.js';
import { saidOfRuns } from '../../../threads/list/said.js';

export type Said = { readonly role?: 'assistant' | 'user'; readonly text?: unknown; readonly tool?: true };

export const transcript = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  threadId: string,
  runId: string,
  status: 'running' | 'completed' | 'failed',
  said: readonly Said[],
) {
  yield* Effect.gen(function* () {
    yield* db.insert(threadRun()).values({
      id: runId,
      threadId,
      ownerId: 'operator',
      status,
      ...(status === 'running'
        ? { startedAt: new Date(yield* Clock.currentTimeMillis), heartbeatAt: new Date(yield* Clock.currentTimeMillis) }
        : { finishedAt: new Date('2026-09-24T00:00:00.000Z') }),
    });
    if (said.length === 0) return;
    yield* db.insert(threadEntry()).values(
      said.map((one, ord) => {
        const id = `${runId}-${ord}`;
        return {
          threadId,
          ord,
          entryId: id,
          runId,
          type: one.tool ? 'tool' : 'message',
          entry: sql`${JSON.stringify(
            one.tool
              ? { type: 'tool', id, runId, toolName: 'read', toolCallId: id, toolState: 'output-available' }
              : { type: 'message', id, runId, role: one.role ?? 'assistant', text: one.text ?? '' },
          )}`,
        };
      }),
    );
    yield* saidOfRuns(db, threadId, [runId]);
  }).pipe(Effect.orDie);
});
