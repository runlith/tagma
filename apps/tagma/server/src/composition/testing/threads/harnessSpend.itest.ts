import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Usage } from '@runlith/llm/schema/events';
import { NATIVE_BINDING, type TransportBinding } from '@runlith/agent/thread/record';
import { harnessSpend, threadRun } from '../../../threads/testing/doubles.js';
import { threadStoreFixture } from '../threadStoreFixture.js';

it.live(
  'a harness is charged for the runs of the threads bound to it, whatever provider the run named, and a run without usage is unmeasured',
  Effect.fnUntraced(function* () {
    const { db, units, store, threads, projectId } = yield* threadStoreFixture;
    const bound = (transport: TransportBinding, runId: string, provider: string | null, totalTokens: number | null) =>
      units
        .write('ThreadStore', (unit) =>
          Effect.gen(function* () {
            const created = yield* store.insert({ ownerId: 'operator', agentId: 'tagma', transport }, unit);
            yield* threads.rows.attachFacet({ threadId: created.id, projectId }, unit);
            yield* unit.run(
              db.insert(threadRun()).values({
                id: runId,
                threadId: created.id,
                ownerId: 'owner',
                status: 'completed',
                provider,
                usage: totalTokens === null ? null : new Usage({ totalTokens }),
                finishedAt: new Date('2026-01-01T00:00:00.000Z'),
              }),
            );
            return created.id;
          }),
        )
        .pipe(Effect.orDie);
    const spentBy = (rootId: string) => harnessSpend(db, units, 'claude-code', rootId, 'operator');
    const hosted = yield* bound({ adapter: 'acp', profile: 'claude-code', agent: 'tagma' }, 'run-hosted', 'claude-code', 7);
    const terminal = yield* bound({ adapter: 'terminal', profile: 'claude-code', agent: null }, 'run-terminal', null, null);
    const native = yield* bound(NATIVE_BINDING, 'run-native', 'claude', 5);
    expect(yield* spentBy(hosted)).toEqual({ tokens: 7, unmeasured: [] });
    expect(yield* spentBy(terminal)).toEqual({ tokens: 0, unmeasured: ['run-terminal'] });
    expect(yield* spentBy(native)).toEqual({ tokens: 0, unmeasured: [] });
  }),
);
