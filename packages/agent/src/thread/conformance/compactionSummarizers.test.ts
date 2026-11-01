import { it } from '@runlith/effect-test';
import { expect } from 'bun:test';
import { Effect } from 'effect';
import { ThreadCallBroke } from '../ThreadBorder';
import { NATIVE_CAPABILITIES, TransportCannotError } from '../record';
import type { ThreadWriteTx } from '../ThreadPorts';
import { fakeAdapter } from './fakeTransport';
import { hold, opened, quiet, started, SUMMARY, until, opensOnHead, transcriptOf, compactionsOf } from './compactionWorld';
import { seeded } from './compactionRequests/support';
import { describeThreadCompactionSummarizers } from './compactionSummarizers';
import { openMemoryStorage } from './memoryStorage';

describeThreadCompactionSummarizers('InMemory', openMemoryStorage, it.live);

it.live('a manual compact of a vendor-owned session refuses without replacing or folding its history', () =>
  Effect.gen(function* () {
    const stack = yield* opened(openMemoryStorage);
    const { world, storage, threadId, handle } = stack;
    yield* seeded(stack);
    yield* storage.aggregate.update(threadId, {
      transport: { adapter: 'hosted', profile: null, agent: null },
      capabilities: { ...NATIVE_CAPABILITIES, history: 'session', compaction: 'vendor' },
    });
    world.summaries.push({ summary: SUMMARY });
    const answer = yield* Effect.result(handle.compact({ at: 'end' }));
    if (answer._tag === 'Success') {
      yield* quiet(world, threadId);
      return yield* Effect.die('The vendor-owned session accepted a Tagma compaction.');
    }
    expect(answer.failure).toBeInstanceOf(ThreadCallBroke);
    if (!(answer.failure instanceof ThreadCallBroke)) return;
    expect(answer.failure.cause).toBeInstanceOf(TransportCannotError);
    expect(yield* storage.compaction.latestCheckpoint(threadId)).toBeNull();
    expect((yield* world.harness.reads.snapshot(threadId)).activeRun).toBeNull();
  }),
);

it.live('an exhausted vendor session folds once and continues from the checkpoint, but a second overflow stays failed', () =>
  Effect.gen(function* () {
    const stack = yield* opened(openMemoryStorage);
    const { world, storage, threadId, handle } = stack;
    yield* seeded(stack);
    const scope = yield* Effect.scope;
    let session: string | null = 'warm-session';
    const adapter = fakeAdapter(
      'hosted',
      { history: 'session', compaction: 'vendor' },
      {
        history: {
          restore: () => Effect.void,
          fork: () => Effect.void,
          moved: () => Effect.void,
          reset: () =>
            Effect.sync(() => {
              session = null;
            }),
        },
      },
    );
    const reports = world.harness.runs.reports().of('hosted');
    const fail = (id: string) =>
      storage.aggregate.transaction((tx) =>
        reports
          .ended(
            { id, threadId },
            {
              kind: 'failed',
              reason: 'context_length_exceeded',
              cause: { stage: 'vendor.turn', type: 'ContextOverflow', contextOverflow: true, retryable: false, modelStarted: false },
            },
          )
          .run(tx as unknown as ThreadWriteTx),
      );
    yield* world.harness.runs.transports().register({
      ...adapter.transport,
      runs: {
        ...adapter.transport.runs,
        launch: Effect.fnUntraced(function* (launch) {
          yield* adapter.transport.runs.launch(launch);
          if (session === null) {
            adapter.held.delete(launch.run.id);
            yield* Effect.forkIn(fail(launch.run.id).pipe(Effect.orDie), scope);
          }
        }),
      },
    });
    yield* storage.aggregate.update(threadId, {
      transport: { adapter: 'hosted', profile: null, agent: null },
      capabilities: { ...NATIVE_CAPABILITIES, history: 'session', compaction: 'vendor' },
    });
    world.summarizers = {
      kind: 'chain',
      reason: 'foreign',
      members: [{ provider: 'summarizer-x', model: 'x-1', reasoning: null }],
      skipped: [],
    };
    world.summaries.push({ summary: SUMMARY });
    const runId = yield* started(handle, 'Continue the work.');
    yield* until(() => Effect.sync(() => adapter.launches.some((launch) => launch.run.id === runId)));
    adapter.held.delete(runId);
    yield* fail(runId);
    yield* quiet(world, threadId);
    expect((yield* storage.compaction.latestCheckpoint(threadId))?.summary).toBe(SUMMARY);
    expect(session).toBeNull();
    expect(adapter.launches.map((launch) => opensOnHead(launch.thread.history))).toEqual([false, true]);
    expect((yield* world.harness.reads.snapshot(threadId)).latestRun?.status).toBe('failed');
    expect(compactionsOf(yield* transcriptOf(storage, threadId)).filter((entry) => entry.status === 'completed')).toHaveLength(1);
  }),
);

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
