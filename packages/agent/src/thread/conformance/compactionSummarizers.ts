import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { ThreadNoSummarizerError } from '../storage/compaction';
import { SUMMARY, compactionsOf, hold, opened, opensOnHead, quiet, started, transcriptOf } from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
import { seeded, compactionRunsOf, onlyCompactionRun, requestOf, standingOf } from './compactionRequests/support';
export function describeThreadCompactionSummarizers<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: who summarizes an operator's compaction`, () => {
    const summarizer = { provider: 'summarizer-x', model: 'x-1', reasoning: null } as const;
    const unspendable = { provider: 'summarizer-x', model: 'x-1', reason: 'quota', until: '2026-09-25T18:40:00.000Z' } as const;
    test(
      'an end request resolves its summarizer when a run takes it: a cache that cooled while it waited sends it to the chain',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const own = yield* world.harness.reads.snapshot(threadId);
        const running = hold();
        world.answers.push({ text: 'The work is done.', held: running });
        yield* started(stack.handle, 'Do the work.');
        yield* running.reached;
        world.summarizers = { kind: 'own', reason: 'warm' };
        const barrier = requestOf(yield* handle.compact({ at: 'end' }));
        world.summarizers = { kind: 'chain', reason: 'cold', members: [summarizer], skipped: [] };
        const summary = hold();
        world.summaries.push({ summary: SUMMARY, held: summary });
        running.release();
        yield* summary.reached;
        expect(onlyCompactionRun(yield* transcriptOf(storage, threadId))).toMatchObject({
          status: 'running',
          summarizer: { provider: 'summarizer-x', model: 'x-1', own: false, reason: 'cold', skipped: [] },
        });
        summary.release();
        yield* quiet(world, threadId);
        expect(world.summarizedBy).toEqual(['summarizer-x']);
        const compacting = onlyCompactionRun(yield* transcriptOf(storage, threadId));
        expect(compacting).toMatchObject({
          status: 'completed',
          summarizer: { provider: 'summarizer-x', model: 'x-1', own: false, reason: 'cold', skipped: [], passes: 1 },
        });
        expect(yield* standingOf(storage, barrier.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
        const after = yield* world.harness.reads.snapshot(threadId);
        expect([after.thread.provider, after.thread.model, after.thread.account, after.thread.reasoning]).toEqual([
          own.thread.provider,
          own.thread.model,
          own.thread.account,
          own.thread.reasoning,
        ]);
      }),
    );
    test(
      'an idle compaction names the thread’s own model from its running entry when the rule keeps it',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const own = yield* world.harness.reads.snapshot(threadId);
        world.summarizers = { kind: 'own', reason: 'warm' };
        const summary = hold();
        world.summaries.push({ summary: SUMMARY, held: summary });
        yield* handle.compact({});
        yield* summary.reached;
        expect(onlyCompactionRun(yield* transcriptOf(storage, threadId))).toMatchObject({
          status: 'running',
          summarizer: { provider: own.thread.provider, model: own.thread.model, own: true, reason: 'warm', skipped: [] },
        });
        summary.release();
        yield* quiet(world, threadId);
        expect(onlyCompactionRun(yield* transcriptOf(storage, threadId))).toMatchObject({
          status: 'completed',
          summarizer: { provider: own.thread.provider, own: true, reason: 'warm', passes: 1 },
        });
      }),
    );
    test(
      'a step request a running run takes resolves counted warm, and a chain the rule hands it to summarizes mid-run while the run goes on',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        world.summarizers = { kind: 'chain', reason: 'always', members: [summarizer], skipped: [] };
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* quiet(world, threadId);
        expect(world.summarizedBy).toEqual(['summarizer-x']);
        const entries = compactionsOf(yield* transcriptOf(storage, threadId));
        expect(entries.find((entry) => entry.runId === runId && entry.mode === 'manual')).toMatchObject({
          status: 'completed',
          summarizer: { provider: 'summarizer-x', own: false, reason: 'always' },
        });
        expect(opensOnHead(world.requests.at(-1))).toBe(true);
      }),
    );
    test(
      'step requests naming different summarizers are never folded into one pass: each is taken at its own step and summarized by the model it named',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { tool: 'work' }, { text: 'The work is done.' });
        yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const x = requestOf(yield* handle.compact({ at: 'step', summarizer: { provider: 'summarizer-x', model: 'x-1' } }));
        const y = requestOf(yield* handle.compact({ at: 'step', summarizer: { provider: 'summarizer-y', model: 'y-1' } }));
        tool.release();
        yield* quiet(world, threadId);
        expect(y.requestId).not.toBe(x.requestId);
        expect(world.summarizedBy).toEqual(['summarizer-x', 'summarizer-y']);
        const named = compactionsOf(yield* transcriptOf(storage, threadId)).flatMap((entry) =>
          entry.summarizer === undefined ? [] : [entry.summarizer.provider],
        );
        expect(named).toEqual(['summarizer-x', 'summarizer-y']);
      }),
    );
    test(
      'with nothing spendable an idle compaction refuses naming each member, and a queued one records them; no summary is asked of anyone',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        world.summarizers = { kind: 'none', reason: 'cold', skipped: [unspendable] };
        const refused = yield* Effect.flip(handle.compact({ at: 'step' }));
        expect(refused).toBeInstanceOf(ThreadNoSummarizerError);
        expect(refused).toMatchObject({ skipped: [unspendable] });
        expect(compactionRunsOf(yield* transcriptOf(storage, threadId))).toHaveLength(0);
        const running = hold();
        world.answers.push({ text: 'The work is done.', held: running });
        yield* started(stack.handle, 'Do the work.');
        yield* running.reached;
        requestOf(yield* handle.compact({ at: 'end' }));
        running.release();
        yield* quiet(world, threadId);
        expect(onlyCompactionRun(yield* transcriptOf(storage, threadId))).toMatchObject({
          status: 'failed',
          noSummarizer: { skipped: [unspendable] },
        });
        expect(world.summarized).toBe(0);
      }),
    );
  });
}
