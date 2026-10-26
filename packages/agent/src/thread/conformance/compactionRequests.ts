import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import {
  EARLIER,
  OWNER,
  SCOPE,
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
import { seeded, onlyCompactionRun, requestOf, queuedIdOf, userMessage, standingOf, latestRun } from './compactionRequests/support';
export function describeThreadCompactionRequests<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: an operator's compaction reaching a running thread`, () => {
    for (const measured of [true, false]) {
      test(
        `a step request taken mid-loop compacts the next request and the run goes on by itself (${measured ? 'a warm measured prefix' : 'nothing measured'})`,
        Effect.fnUntraced(function* () {
          const stack = yield* opened(open, { measured });
          const { storage, world, threadId, handle } = stack;
          yield* seeded(stack);
          const tool = hold();
          world.tool = tool;
          world.answers.push({ tool: 'work' }, { text: 'The work is done.' });
          const runId = yield* started(stack.handle, 'Do the work.');
          yield* tool.reached;
          const asked = requestOf(yield* handle.compact({ at: 'step', keep: 'the file list' }));
          expect(asked).toMatchObject({ at: 'step', runId });
          const { requestId } = asked;
          const waiting = yield* world.harness.reads.snapshot(threadId);
          expect(waiting.pendingInput.steers).toMatchObject([
            { id: requestId, runId, kind: 'compaction', keep: 'the file list', text: '' },
          ]);
          tool.release();
          yield* quiet(world, threadId);
          expect(world.requests).toHaveLength(3);
          const next = world.requests[2];
          expect(opensOnHead(next)).toBe(true);
          expect(next?.slice(2).map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
          expect(textOf(next?.[2])).toBe('Do the work.');
          const entries = yield* transcriptOf(storage, threadId);
          const entry = compactionsOf(entries).find((each) => each.id === `compaction:${runId}:1:requested`);
          expect(entry).toMatchObject({ runId, mode: 'manual', status: 'completed', receipt: { cause: 'manual' } });
          expect(entry?.receipt?.measuredTokens === undefined).toBe(!measured);
          expect(
            entries.filter(
              (each) =>
                each.type === 'message' &&
                (
                  each as {
                    runId?: string;
                  }
                ).runId === runId &&
                (
                  each as {
                    role?: string;
                  }
                ).role === 'user',
            ),
          ).toHaveLength(1);
          expect(yield* latestRun(storage, threadId)).toMatchObject({ id: runId, status: 'completed' });
          expect(yield* standingOf(storage, requestId)).toEqual({ state: 'acknowledged', runId });
        }),
      );
    }
    test(
      'a step request arriving in the terminal step costs no model call; a compaction run follows, then the queue',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const call = hold();
        world.answers.push({ text: 'Done in one step.', held: call }, { text: 'B is answered.' });
        const runId = yield* started(stack.handle, 'Answer at once.');
        yield* call.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        queuedIdOf(yield* handle.queue('And then B.'));
        call.release();
        yield* quiet(world, threadId);
        expect(asked).toMatchObject({ at: 'step', runId });
        expect(world.requests).toHaveLength(3);
        const entries = yield* transcriptOf(storage, threadId);
        const compacting = onlyCompactionRun(entries);
        expect(compacting).toMatchObject({ mode: 'manual', status: 'completed' });
        expect(compacting.runId).not.toBe(runId);
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId: compacting.runId });
        const b = userMessage(entries, 'And then B.');
        expect(b.index).toBeGreaterThan(entries.findIndex((entry) => entry.id === compacting.id));
        expect(opensOnHead(world.requests[2])).toBe(true);
      }),
    );
    test(
      'a barrier queued between two turns runs as its own compaction run, in the order the three were accepted',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const running = hold();
        world.answers.push({ text: 'The first work is done.', held: running }, { text: 'A is answered.' }, { text: 'B is answered.' });
        const runId = yield* started(stack.handle, 'Begin.');
        yield* running.reached;
        const a = queuedIdOf(yield* handle.queue('A please.'));
        const barrier = requestOf(yield* handle.compact({ at: 'end' }));
        const b = queuedIdOf(yield* handle.queue('B please.'));
        expect(barrier).toMatchObject({ at: 'end', runId });
        const waiting = yield* world.harness.reads.snapshot(threadId);
        expect(waiting.pendingInput.queued.map((row) => [row.id, row.kind])).toEqual([
          [a, undefined],
          [barrier.requestId, 'compaction'],
          [b, undefined],
        ]);
        running.release();
        yield* quiet(world, threadId);
        const entries = yield* transcriptOf(storage, threadId);
        const compacting = onlyCompactionRun(entries);
        const first = userMessage(entries, 'A please.');
        const second = userMessage(entries, 'B please.');
        const between = entries.findIndex((entry) => entry.id === compacting.id);
        expect(first.index).toBeGreaterThanOrEqual(0);
        expect(first.index).toBeLessThan(between);
        expect(between).toBeLessThan(second.index);
        expect(new Set([first.runId, compacting.runId, second.runId, runId]).size).toBe(4);
        expect(world.requests).toHaveLength(4);
        expect(opensOnHead(world.requests[2])).toBe(false);
        expect(opensOnHead(world.requests[3])).toBe(true);
      }),
    );
    test(
      'a cut run wakes nothing for its step request; Continue resumes and its first projection takes it',
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
        const runId = yield* started(handle, 'Do the work.');
        yield* parked.reached;
        const asked = requestOf(yield* handle.compact({ at: 'step' }));
        yield* processA.dispose();
        const processB = yield* compactionWorld(storage, thread.agentId, { resumeWithinMs: 0 });
        expect(yield* processB.harness.runs.recoverNow()).toBe(1);
        expect(yield* latestRun(storage, thread.id)).toMatchObject({ id: runId, status: 'cut' });
        yield* quiet(processB, thread.id);
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'queued', runId: null });
        expect((yield* processB.harness.reads.snapshot(thread.id)).pendingInput.steers).toMatchObject([
          { id: asked.requestId, kind: 'compaction' },
        ]);
        processB.answers.push({ text: 'Continued.' });
        const continued = yield* processB.harness.threads.handle(thread.id, OWNER).continue();
        yield* quiet(processB, thread.id);
        expect(continued.runId).not.toBe(runId);
        expect(opensOnHead(processB.requests[0])).toBe(true);
        const entry = compactionsOf(yield* transcriptOf(storage, thread.id)).find((each) => each.runId === continued.runId);
        expect(entry).toMatchObject({ mode: 'manual', status: 'completed', receipt: { cause: 'manual' } });
        expect(yield* standingOf(storage, asked.requestId)).toEqual({ state: 'acknowledged', runId: continued.runId });
      }),
    );
  });
}
