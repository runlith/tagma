import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import {
  BRIEF,
  EARLIER,
  OWNER,
  SCOPE,
  SUMMARY,
  compactionWorld,
  compactionsOf,
  hold,
  opened,
  opensOnHead,
  quiet,
  started,
  textOf,
  transcriptOf,
} from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
import {
  seeded,
  compactionRunsOf,
  onlyCompactionRun,
  requestOf,
  queuedIdOf,
  standingOf,
  latestRun,
  userMessage,
} from './compactionRequests/support';
export function describeThreadCompactionPasses<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a requested compaction pass across cuts, failures and merged requests`, () => {
    test(
      'a compaction asked of a cut thread takes the step request standing there, and nothing compacts twice',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* compactionWorld(storage, thread.agentId);
        const handle = processA.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('trust');
        processA.answers.push({ text: EARLIER });
        yield* started(handle, 'What stands so far?');
        yield* quiet(processA, thread.id);
        const parked = hold();
        processA.answers.push({ parks: parked });
        yield* started(handle, 'Do the work.');
        yield* parked.reached;
        const standing = requestOf(yield* handle.compact({ at: 'step' }));
        yield* processA.dispose();
        const processB = yield* compactionWorld(storage, thread.agentId, { resumeWithinMs: 0 });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* quiet(processB, thread.id);
        const now = yield* processB.harness.threads.handle(thread.id, OWNER).compact({ at: 'step' });
        yield* quiet(processB, thread.id);
        expect(now.status).toBe('started');
        const compacting = onlyCompactionRun(yield* transcriptOf(storage, thread.id));
        expect(compacting.runId).toBe(now.runId);
        expect(processB.summarized).toBe(1);
        expect(yield* standingOf(storage, standing.requestId)).toEqual({ state: 'acknowledged', runId: now.runId });
      }),
    );
    test(
      'a compaction run cut after its process left opens the words queued behind it',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const thread = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const processA = yield* compactionWorld(storage, thread.agentId);
        const handle = processA.harness.threads.handle(thread.id, OWNER);
        yield* handle.setAuthorityMode('trust');
        processA.answers.push({ text: EARLIER });
        yield* started(handle, 'What stands so far?');
        yield* quiet(processA, thread.id);
        const summary = hold();
        processA.summaries.push({ summary: SUMMARY, held: summary });
        const compacting = yield* handle.compact({ at: 'end' });
        yield* summary.reached;
        queuedIdOf(yield* handle.queue('A please.'));
        yield* processA.dispose();
        const processB = yield* compactionWorld(storage, thread.agentId, { resumeWithinMs: 0 });
        processB.answers.push({ text: 'A is done.' });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        yield* quiet(processB, thread.id);
        const entries = yield* transcriptOf(storage, thread.id);
        const asked = userMessage(entries, 'A please.');
        expect(asked.runId).toBeDefined();
        expect(asked.runId).not.toBe(compacting.runId);
        expect(yield* latestRun(storage, thread.id)).toMatchObject({ id: asked.runId, status: 'completed' });
      }),
    );
    test(
      'a requested pass whose summarizer fails is recorded failed, and the run goes on unreduced',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.summaries.push({ fails: 'The summarizer is unreachable.' });
        world.answers.push({ tool: 'work' }, { text: 'Done without it.' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* quiet(world, threadId);
        expect(
          compactionsOf(yield* transcriptOf(storage, threadId)).find((entry) => entry.id === `compaction:${runId}:1:requested`),
        ).toMatchObject({ mode: 'manual', status: 'failed' });
        expect(textOf(world.requests[2]?.[0])).toBe('What stands so far?');
        expect(yield* latestRun(storage, threadId)).toMatchObject({ id: runId, status: 'completed' });
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId });
      }),
    );
    test(
      'a requested pass with nothing to cover is recorded unchanged, and the run goes on',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* quiet(world, threadId);
        expect(compactionsOf(yield* transcriptOf(storage, threadId))).toMatchObject([
          { id: `compaction:${runId}:1:requested`, mode: 'manual', status: 'unchanged', receipt: { cause: 'manual' } },
        ]);
        expect(world.summarized).toBe(0);
        expect(yield* latestRun(storage, threadId)).toMatchObject({ id: runId, status: 'completed' });
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId });
      }),
    );
    test(
      'a second step request answers the standing one, a barrier with nothing between joins it, and other words to keep stand apart yet ride the same pass',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        const runId = yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        const first = requestOf(yield* handle.compact({ at: 'step' }));
        const again = yield* handle.compact({ at: 'step' });
        const behind = yield* handle.compact({ at: 'end' });
        const kept = requestOf(yield* handle.compact({ at: 'step', keep: 'the migration plan' }));
        tool.release();
        yield* quiet(world, threadId);
        expect(again).toEqual(first);
        expect(behind).toEqual(first);
        expect(kept.requestId).not.toBe(first.requestId);
        expect(compactionsOf(yield* transcriptOf(storage, threadId)).map((entry) => entry.id)).toEqual([`compaction:${runId}:1:requested`]);
        expect(world.summarized).toBe(1);
        expect(world.prompts[0]).toContain('the migration plan');
        expect(yield* standingOf(storage, first.requestId)).toEqual({ state: 'acknowledged', runId });
        expect(yield* standingOf(storage, kept.requestId)).toEqual({ state: 'acknowledged', runId });
      }),
    );
    test(
      'a call retried after the requested pass keeps the compacted request, and pays no second summary',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { stalls: true }, { text: 'The work is done.' });
        yield* started(stack.handle, 'Do the work.');
        yield* tool.reached;
        requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* quiet(world, threadId);
        expect(world.requests).toHaveLength(4);
        expect(opensOnHead(world.requests[2])).toBe(true);
        expect(opensOnHead(world.requests[3])).toBe(true);
        expect(world.summarized).toBe(1);
      }),
    );
    test(
      'an end request that finds the run ended with turns still queued waits behind them instead of compacting first',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const settled = yield* latestRun(storage, threadId);
        const waiting = {
          id: 'turn:left-by-the-ending',
          threadId,
          sender: { kind: 'reader' as const },
          kind: 'turn' as const,
          body: { text: 'A please.' },
          occurredAt: new Date((yield* Clock.currentTimeMillis) - 1_000).toISOString(),
        };
        yield* storage.inbox.put(waiting);
        const asked = requestOf(yield* handle.compact({ at: 'end' }));
        expect(asked).toMatchObject({ at: 'end', runId: settled?.id });
        expect(world.summarized).toBe(0);
        expect((yield* storage.inbox.pending(threadId)).map((item) => [item.id, item.state])).toEqual([
          [waiting.id, 'queued'],
          [asked.requestId, 'queued'],
        ]);
      }),
    );
    test(
      'adjacent barriers collapse into one compaction run, whether accepted adjacent or left adjacent by a take-back',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const running = hold();
        world.answers.push({ text: 'The work is done.', held: running });
        yield* started(stack.handle, 'Begin.');
        yield* running.reached;
        const first = requestOf(yield* handle.compact({ at: 'end' }));
        const adjacent = requestOf(yield* handle.compact({ at: 'end' }));
        const between = queuedIdOf(yield* handle.queue('A please.'));
        const later = requestOf(yield* handle.compact({ at: 'end' }));
        expect(adjacent.requestId).toBe(first.requestId);
        expect(later.requestId).not.toBe(first.requestId);
        expect(yield* handle.unqueue(between)).toBe(true);
        expect((yield* world.harness.reads.snapshot(threadId)).pendingInput.queued.map((row) => [row.id, row.kind])).toEqual([
          [first.requestId, 'compaction'],
          [later.requestId, 'compaction'],
        ]);
        running.release();
        yield* quiet(world, threadId);
        const compacting = onlyCompactionRun(yield* transcriptOf(storage, threadId));
        expect(world.summarized).toBe(1);
        expect(yield* standingOf(storage, first.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
        expect(yield* standingOf(storage, later.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
      }),
    );
    test(
      'an idle thread compacts at once for either point, and a request while that run compacts answers the run',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const summary = hold();
        world.summaries.push({ summary: SUMMARY, held: summary });
        const now = yield* handle.compact({ at: 'end' });
        yield* summary.reached;
        const stepping = yield* handle.compact({ at: 'step' });
        const ending = yield* handle.compact({ at: 'end' });
        summary.release();
        yield* quiet(world, threadId);
        expect(now.status).toBe('started');
        expect(stepping).toEqual(now);
        expect(ending).toEqual(now);
        expect(compactionRunsOf(yield* transcriptOf(storage, threadId)).map((entry) => [entry.runId, entry.status])).toEqual([
          [now.runId, 'completed'],
        ]);
        expect(world.summarized).toBe(1);
      }),
    );
    test(
      'a step request whose cut splits the running turn keeps its opening words verbatim after the summary, in the next request and the stored history',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const tool = hold();
        world.tool = tool;
        world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
        yield* started(stack.handle, BRIEF);
        yield* tool.reached;
        requestOf(yield* handle.compact({ at: 'step' }));
        tool.release();
        yield* quiet(world, threadId);
        const next = world.requests[2];
        expect(opensOnHead(next)).toBe(true);
        expect(textOf(next?.[2])).toBe(BRIEF);
        expect(next?.slice(3).map((message) => message.role)).toEqual(['assistant', 'tool']);
        expect(world.prompts[0]).toContain('PARSE-17');
        expect((yield* storage.compaction.latestCheckpoint(threadId))?.coveredMessageCount).toBe(3);
        const history = (yield* storage.aggregate.historyOf(threadId)) ?? [];
        expect(JSON.stringify(history.slice(0, 3))).toBe(JSON.stringify(next?.slice(0, 3)));
        expect(history.filter((message) => textOf(message) === BRIEF)).toHaveLength(1);
      }),
    );
  });
}
