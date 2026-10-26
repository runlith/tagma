import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { threadReportEnvelopeId } from '../../collaboration/envelopeKeys';
import type { ThreadChildCompacted } from '../../collaboration/ThreadPlaneAccess';
import { spawnRequestId } from '../../collaboration/births';
import { BRIEF, EARLIER, OWNER, SCOPE, SUMMARY, compactionsOf, hold, opened, opensOnHead, quiet, transcriptOf } from './compactionWorld';
import type { ThreadStorageFactory } from './storagePort';
import {
  spawnedChild,
  compactAgentCall,
  planned,
  sendTaskCall,
  heardTimes,
  reportRead,
  compactionRunsOf,
  onlyCompactionRun,
  standingOf,
  latestRun,
  PAID_SUMMARIZER,
  SKIPPED_SUMMARIZER,
} from './compactionRequests/support';
export function describeThreadCompactionParent<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a parent compacting a descendant through compact_agent`, () => {
    test(
      'a running child with `at` is answered at once with the request, which its own run takes at its next step',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const tool = hold();
        world.tool = tool;
        const childId = yield* spawnedChild(stack, { tool: 'work' });
        yield* tool.reached;
        const childRun = yield* latestRun(storage, childId);
        if (childRun === null) return yield* Effect.die('The child never opened a run.');
        const call = yield* compactAgentCall(stack, { threadId: childId, at: 'step', keep: 'the file list' });
        const answered = call.toolOutput as ThreadChildCompacted;
        expect(answered).toMatchObject({ status: 'requested', at: 'step', runId: childRun.id });
        if (answered.status !== 'requested') return yield* Effect.die('The call answered no request.');
        expect(yield* latestRun(storage, childId)).toMatchObject({ id: childRun.id, status: 'running' });
        expect((yield* world.harness.reads.snapshot(childId)).pendingInput.steers).toMatchObject([
          { id: answered.requestId, kind: 'compaction', keep: 'the file list' },
        ]);
        world.answers.push({ text: 'The work is done.' }, { text: 'Read the report.' });
        tool.release();
        yield* quiet(world, childId);
        yield* reportRead(stack, call.runId);
        expect(yield* standingOf(storage, answered.requestId)).toEqual({ state: 'acknowledged', runId: childRun.id });
        const taken = compactionsOf(yield* transcriptOf(storage, childId)).filter((entry) => entry.runId === childRun.id);
        expect(taken.map((entry) => entry.mode)).toEqual(['manual']);
        expect(compactionRunsOf(yield* transcriptOf(storage, childId))).toEqual([]);
      }),
    );
    test(
      'a running child without `at` is refused in words naming the parameter, and nothing is asked of it',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const tool = hold();
        world.tool = tool;
        const childId = yield* spawnedChild(stack, { tool: 'work' });
        yield* tool.reached;
        const call = yield* compactAgentCall(stack, { threadId: childId });
        expect(call).toMatchObject({ toolState: 'output-refused', toolRefusal: { code: 'thread-running' } });
        expect((yield* storage.inbox.pending(childId)).filter((item) => item.kind === 'compaction')).toEqual([]);
        world.answers.push({ text: 'The work is done.' }, { text: 'Read the report.' });
        tool.release();
        yield* quiet(world, childId);
        yield* reportRead(stack, call.runId);
        expect(world.summarized).toBe(0);
      }),
    );
    test(
      'an idle child is compacted now and the call waits for the outcome, naming who summarized and whose quota paid',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const childId = yield* spawnedChild(stack, { text: EARLIER }, { text: 'Read the report.' });
        yield* quiet(world, childId);
        yield* quiet(world, stack.threadId);
        world.summarizers = { kind: 'chain', reason: 'cold', members: [PAID_SUMMARIZER], skipped: [SKIPPED_SUMMARIZER] };
        const call = yield* compactAgentCall(stack, { threadId: childId });
        const answered = call.toolOutput as ThreadChildCompacted;
        const [compacting] = compactionRunsOf(yield* transcriptOf(storage, childId));
        expect(answered).toMatchObject({
          status: 'completed',
          runId: compacting?.runId,
          summarizer: { provider: 'summarizer-x', model: 'x-1', account: 'key-x', own: false, reason: 'cold' },
          skipped: [SKIPPED_SUMMARIZER],
        });
        expect(compacting).toMatchObject({ mode: 'manual', status: 'completed' });
        expect(world.summarizedBy).toEqual(['summarizer-x']);
      }),
    );
  });
}
export function describeThreadCompactionTasks<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a parent handing a child a task behind a compaction through send_task`, () => {
    test(
      'an idle child is compacted by the first spendable member at once, and the task opens the first turn on the summary; what another sender wrote meanwhile opens no turn of its own and no task of it goes first',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const childId = yield* spawnedChild(stack, { text: EARLIER }, { text: 'Read the report.' });
        yield* quiet(world, childId);
        yield* quiet(world, stack.threadId);
        world.summarizers = { kind: 'chain', reason: 'cold', members: [PAID_SUMMARIZER], skipped: [SKIPPED_SUMMARIZER] };
        const summarizing = hold();
        world.summaries.push({ summary: SUMMARY, held: summarizing });
        planned(stack, childId, { text: 'Brief taken.' });
        const call = yield* sendTaskCall(stack, { to: [childId], task: BRIEF, compact: {} }, { text: 'Read.' });
        yield* summarizing.reached;
        const peer = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        planned(stack, peer.id, { text: 'Seen.' });
        yield* world.harness.inputs.deliver(childId, OWNER, {
          id: 'envelope:peer-note',
          senderThreadId: peer.id,
          intent: 'message',
          text: 'PEER NOTE: the review started.',
        });
        yield* world.harness.inputs.deliver(childId, OWNER, {
          id: 'envelope:peer-task',
          senderThreadId: peer.id,
          intent: 'task',
          text: 'PEER TASK: tidy the index.',
        });
        summarizing.release();
        const heard = yield* heardTimes(stack, childId, 2);
        const sent = call.toolOutput as {
          deliveries: readonly {
            status: string;
            compaction: {
              requestId: string;
              runId: string | null;
            };
          }[];
        };
        const answered = sent.deliveries[0]!;
        const compacting = onlyCompactionRun(yield* transcriptOf(storage, childId));
        expect(sent.deliveries).toHaveLength(1);
        expect(answered).toMatchObject({
          status: 'queued',
          compaction: {
            runId: compacting.runId,
            summarizer: { provider: 'summarizer-x', model: 'x-1', account: 'key-x', own: false, reason: 'cold' },
          },
        });
        expect(compacting).toMatchObject({ status: 'completed', summarizer: { provider: 'summarizer-x', account: 'key-x', own: false } });
        expect(world.summarizedBy).toEqual(['summarizer-x']);
        expect(yield* standingOf(storage, answered.compaction.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
        expect(heard).toHaveLength(2);
        expect(opensOnHead(heard[1])).toBe(true);
        const said = JSON.stringify(heard[1]);
        expect(said).toContain('PEER NOTE');
        expect(said.indexOf(BRIEF)).toBeGreaterThan(-1);
        expect(said.indexOf('PEER TASK')).toBeGreaterThan(said.indexOf(BRIEF));
      }),
    );
    test(
      'a working child runs the work queued ahead of the compaction first, then the compaction, then the task behind it',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const tool = hold();
        world.tool = tool;
        const childId = yield* spawnedChild(stack, { tool: 'work' });
        yield* tool.reached;
        const peer = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        planned(stack, peer.id, { text: 'Seen.' });
        yield* world.harness.inputs.deliver(childId, OWNER, {
          id: 'envelope:peer-first',
          senderThreadId: peer.id,
          intent: 'task',
          text: 'PEER FIRST: tidy the index.',
        });
        planned(stack, childId, { text: 'The work is done.' }, { text: 'Tidied.' }, { text: 'Brief taken.' });
        world.summarizers = { kind: 'chain', reason: 'cold', members: [PAID_SUMMARIZER], skipped: [] };
        yield* sendTaskCall(stack, { to: [childId], task: BRIEF, compact: {} }, { text: 'Read.' }, { text: 'Read.' });
        tool.release();
        const heard = yield* heardTimes(stack, childId, 4);
        expect(JSON.stringify(heard[2])).toContain('PEER FIRST');
        expect(JSON.stringify(heard[2])).not.toContain(BRIEF);
        expect(opensOnHead(heard[2])).toBe(false);
        expect(opensOnHead(heard[3])).toBe(true);
        expect(JSON.stringify(heard[3])).toContain(BRIEF);
        expect(world.summarizedBy).toEqual(['summarizer-x']);
      }),
    );
  });
}
export function describeThreadCompactionTaskOutcomes<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: compaction outcomes before a child takes its task`, () => {
    test(
      'an idle child with nothing spendable refuses no-summarizer, queues nothing, and names its ways out',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open, { collaboration: true });
        const { storage, world } = stack;
        const childId = yield* spawnedChild(stack, { text: EARLIER }, { text: 'Read the report.' });
        yield* quiet(world, childId);
        yield* quiet(world, stack.threadId);
        const before = yield* latestRun(storage, childId);
        const waiting = yield* storage.inbox.pending(childId);
        world.summarizers = { kind: 'none', reason: 'cold', skipped: [SKIPPED_SUMMARIZER] };
        const call = yield* sendTaskCall(stack, { to: [childId], task: BRIEF, compact: { keep: 'the file list' } });
        expect(call.toolOutput).toMatchObject({ status: 'refused', code: 'no-summarizer', skipped: [SKIPPED_SUMMARIZER] });
        expect(
          (
            call.toolOutput as {
              unblock: readonly string[];
            }
          ).unblock,
        ).toHaveLength(2);
        expect(yield* storage.inbox.pending(childId)).toEqual(waiting);
        expect(yield* latestRun(storage, childId)).toMatchObject({ id: before?.id });
        expect(world.summarized).toBe(0);
      }),
    );
    for (const spendable of [true, false]) {
      test(
        `a working child ends its work, is ${spendable ? 'compacted' : 'refused a compaction the entry records'}, and then opens the task`,
        Effect.fnUntraced(function* () {
          const stack = yield* opened(open, { collaboration: true });
          const { storage, world } = stack;
          const tool = hold();
          world.tool = tool;
          const childId = yield* spawnedChild(stack, { tool: 'work' });
          yield* tool.reached;
          const working = yield* latestRun(storage, childId);
          if (working === null) return yield* Effect.die('The child never opened a run.');
          planned(stack, childId, { text: 'The work is done.' }, { text: 'Brief taken.' });
          const call = yield* sendTaskCall(stack, { to: [childId], task: BRIEF, compact: {} }, { text: 'Read.' }, { text: 'Read.' });
          world.summarizers = spendable
            ? { kind: 'chain', reason: 'cold', members: [PAID_SUMMARIZER], skipped: [] }
            : { kind: 'none', reason: 'cold', skipped: [SKIPPED_SUMMARIZER] };
          tool.release();
          const heard = yield* heardTimes(stack, childId, 3);
          const sent = call.toolOutput as {
            deliveries: readonly {
              status: string;
              runId: string;
              compaction: {
                requestId: string;
                runId: string | null;
              };
            }[];
          };
          const answered = sent.deliveries[0]!;
          expect(sent.deliveries).toHaveLength(1);
          expect(answered).toMatchObject({ status: 'queued', runId: working.id, compaction: { runId: null } });
          const entries = yield* transcriptOf(storage, childId);
          const compacting = onlyCompactionRun(entries);
          expect(compacting).toMatchObject(
            spendable
              ? { status: 'completed', summarizer: { provider: 'summarizer-x' } }
              : { status: 'failed', noSummarizer: { skipped: [SKIPPED_SUMMARIZER] } },
          );
          expect(yield* standingOf(storage, answered.compaction.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
          const tasked = yield* latestRun(storage, childId);
          expect(new Set([working.id, compacting.runId, tasked?.id]).size).toBe(3);
          expect(entries.findIndex((entry) => entry.id === compacting.id)).toBeGreaterThan(
            entries.findIndex(
              (entry) =>
                entry.type === 'message' &&
                (
                  entry as {
                    runId?: string;
                  }
                ).runId === working.id,
            ),
          );
          expect(opensOnHead(heard[2])).toBe(spendable);
          expect(JSON.stringify(heard[2])).toContain(BRIEF);
          expect(
            yield* storage.inbox.receipt(threadReportEnvelopeId(spawnRequestId(stack.threadId, 'call-spawn'), compacting.runId)),
          ).toBeUndefined();
        }),
      );
    }
  });
}
