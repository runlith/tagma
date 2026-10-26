import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import type { ThreadWriteTx } from '../ThreadPorts';
import { NATIVE_CAPABILITIES } from '../record';
import { fakeAdapter } from './fakeTransport';
import { hold, opened, quiet, started, SUMMARY, until, opensOnHead, transcriptOf, compactionsOf } from './compactionWorld';
import { seeded } from './compactionRequests/support';
import { describeThreadCompactionSummarizers } from './compactionSummarizers';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionSummarizers('InMemory', openMemoryStorage, it.live);

it.live('a foreign-only session delays a step request until the turn ends, resets before folding, and launches from the summary', () =>
  Effect.gen(function* () {
    const stack = yield* opened(openMemoryStorage);
    const { world, storage, threadId, handle } = stack;
    yield* seeded(stack);
    const resetCheckpoints: unknown[] = [];
    let session: string | null = 'hosted-session';
    const adapter = fakeAdapter(
      'hosted',
      { history: 'session', compaction: 'foreign' },
      {
        history: {
          restore: () => Effect.void,
          fork: () => Effect.void,
          moved: () => Effect.void,
          reset: Effect.fnUntraced(function* () {
            resetCheckpoints.push(yield* storage.compaction.latestCheckpoint(threadId));
            session = null;
          }),
        },
      },
    );
    yield* world.harness.runs.transports().register(adapter.transport);
    yield* storage.aggregate.update(threadId, {
      transport: { adapter: 'hosted', profile: null, agent: null },
      capabilities: { ...NATIVE_CAPABILITIES, history: 'session', compaction: 'foreign' },
    });
    world.summarizers = {
      kind: 'chain',
      reason: 'foreign',
      members: [{ provider: 'summarizer-x', model: 'x-1', reasoning: null }],
      skipped: [],
    };
    const held = hold();
    world.summaries.push({ summary: SUMMARY, held });
    const runId = yield* started(handle, 'Continue the work.');
    yield* until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === runId)));
    const asked = yield* handle.compact({ at: 'step', mode: 'automatic', keep: 'Keep the release name.' });
    expect(asked).toMatchObject({ status: 'requested', at: 'end', runId });
    expect((yield* world.harness.reads.snapshot(threadId)).activeRun?.id).toBe(runId);
    const reports = world.harness.runs.reports().of('hosted');
    const finish = (id: string) =>
      storage.aggregate.transaction((tx) => reports.ended({ id, threadId }, { kind: 'completed' }).run(tx as unknown as ThreadWriteTx));
    adapter.held.delete(runId);
    yield* finish(runId);
    yield* held.reached;
    expect(session).toBe('hosted-session');
    held.release();
    yield* quiet(world, threadId);
    expect(resetCheckpoints).toEqual([null]);
    expect(session).toBeNull();
    expect((yield* storage.compaction.latestCheckpoint(threadId))?.summary).toBe(SUMMARY);
    expect(compactionsOf(yield* transcriptOf(storage, threadId)).find((entry) => entry.summarizer?.own === false)).toMatchObject({
      status: 'completed',
      mode: 'automatic',
      summarizer: { provider: 'summarizer-x', reason: 'foreign' },
    });
    const next = yield* started(handle, 'Continue from the saved plan.');
    yield* until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === next)));
    expect(opensOnHead(adapter.launches.find((launch) => launch.run.id === next)?.thread.history)).toBe(true);
    adapter.held.delete(next);
    yield* finish(next);
    yield* quiet(world, threadId);
  }),
);
