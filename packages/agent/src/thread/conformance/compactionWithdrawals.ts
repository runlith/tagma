import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { SUMMARY, compactionsOf, hold, opened, opensOnHead, quiet, started, transcriptOf } from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
import { seeded, onlyCompactionRun, requestOf, standingOf, latestRun } from './compactionRequests/support';
export function describeThreadCompactionWithdrawals<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a step request taken back or stopped before its pass`, () => {
    test(
      'a step request taken back before the next projection compacts nothing',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        expect(yield* handle.unqueue(asked.requestId)).toBe(true);
        expect((yield* world.harness.reads.snapshot(threadId)).pendingInput.steers).toEqual([]);
        tool.release();
        yield* quiet(world, threadId);
        expect(compactionsOf(yield* transcriptOf(storage, threadId))).toEqual([]);
        expect(world.summarized).toBe(0);
        expect(opensOnHead(world.requests[2])).toBe(false);
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId: null });
      }),
    );
    test(
      'a step request the anchor already took cannot be taken back',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        const summary = hold();
        world.tool = tool;
        world.summaries.push({ summary: SUMMARY, held: summary });
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* summary.reached;
        expect(yield* handle.unqueue(asked.requestId)).toBe(false);
        expect(requestOf(yield* handle.compact({ at: 'step' })).requestId).toBe(asked.requestId);
        summary.release();
        yield* quiet(world, threadId);
        expect(
          compactionsOf(yield* transcriptOf(storage, threadId)).find((entry) => entry.id === `compaction:${runId}:1:requested`)?.status,
        ).toBe('completed');
        expect(world.summarized).toBe(1);
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId });
      }),
    );
    test(
      'a stop over an untaken step request is followed by a compaction run',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const parked = hold();
        world.answers.push({ parks: parked });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* parked.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* quiet(world, threadId);
        const compacting = onlyCompactionRun(yield* transcriptOf(storage, threadId));
        expect(compacting).toMatchObject({ mode: 'manual', status: 'completed' });
        expect(compacting.runId).not.toBe(runId);
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
      }),
    );
    test(
      'a stop during the requested pass records it aborted, and nothing runs it again',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        const stall = hold();
        world.tool = tool;
        world.summaries.push({ stalls: stall });
        world.answers.push({ tool: 'work' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* stall.reached;
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* quiet(world, threadId);
        const entries = compactionsOf(yield* transcriptOf(storage, threadId));
        expect(entries).toMatchObject([
          { id: `compaction:${runId}:1:requested`, mode: 'manual', status: 'aborted', receipt: { cause: 'manual' } },
        ]);
        expect(world.summarized).toBe(1);
        expect(yield* latestRun(storage, threadId)).toMatchObject({ id: runId, status: 'aborted' });
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId });
      }),
    );
  });
}
