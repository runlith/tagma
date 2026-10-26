import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Effect, type Scope } from 'effect';
import { threadCauseOf } from '../ThreadBorder';
import { ThreadSignalConflictError } from '../run/scheduler/inputs';
import { keepWarmSignalId } from '../../transcript/keepWarm';
import { entryOf } from '../../transcript/kinds';
import { SUMMARY, hold, opened, quiet, started, transcriptOf, until } from './compactionWorld';
import { seeded } from './compactionRequests/support';
import type { ThreadStorageFactory } from './storagePort';
const REPORT = { type: 'report', addressee: 'transport' } as const;
export function describeThreadSignals<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: a signal reaches the thread once, in the run that reads it`, () => {
    test(
      'a named signal wakes one run however often it is sent, and other words under its name are refused untouched',
      Effect.fnUntraced(function* () {
        const { storage, world, threadId, handle } = yield* opened(open);
        world.answers.push({ text: 'Read it.' });
        const named = { ...REPORT, id: 'child-run:run-9:completed', text: 'the upstream job finished' };
        const woken = yield* handle.sendSignal(named);
        expect(woken).toMatchObject({ status: 'woken' });
        yield* quiet(world, threadId);
        expect(yield* handle.sendSignal(named)).toMatchObject({ status: 'delivered', runId: 'runId' in woken ? woken.runId : '' });
        const refusal = yield* Effect.flip(handle.sendSignal({ ...named, text: 'the upstream job failed' }));
        expect(threadCauseOf(refusal)).toBeInstanceOf(ThreadSignalConflictError);
        expect(world.requests).toHaveLength(1);
        expect((yield* storage.inbox.receipt(named.id))?.body).toMatchObject({ text: 'the upstream job finished' });
      }),
    );
    test(
      'a signal whose condition no longer holds is declined on every road and leaves nothing behind; one that holds asks once',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        const declined = { condition: () => Effect.succeed(false) };
        const working = hold();
        world.answers.push({ text: 'Working.', held: working });
        expect(yield* handle.sendSignal({ ...REPORT, text: 'wake' }, declined)).toEqual({ status: 'declined' });
        expect(yield* handle.sendSignal({ ...REPORT, text: 'keep' }, { ...declined, ifIdle: 'persist' })).toEqual({ status: 'declined' });
        yield* started(stack.handle, 'Work.');
        yield* working.reached;
        expect(yield* handle.sendSignal({ ...REPORT, text: 'deliver' }, declined)).toEqual({ status: 'declined' });
        expect(yield* handle.sendSignal({ ...REPORT, text: 'persist' }, { ...declined, ifActive: 'persist' })).toEqual({
          status: 'declined',
        });
        working.release();
        yield* quiet(world, threadId);
        expect(yield* storage.inbox.pending(threadId)).toEqual([]);
        expect(world.requests).toHaveLength(1);
        let asked = 0;
        const once = { condition: () => Effect.sync(() => ++asked === 1) };
        const named = { ...REPORT, id: 'command:exec-1:1:call-1', text: 'the command finished' };
        world.answers.push({ text: 'Read it.' });
        expect(yield* handle.sendSignal(named, once)).toMatchObject({ status: 'woken' });
        yield* quiet(world, threadId);
        expect(yield* handle.sendSignal(named, once)).toMatchObject({ status: 'delivered' });
        expect(asked).toBe(1);
        expect(world.requests).toHaveLength(2);
      }),
    );
    test(
      'two signals sent together to an idle thread open one run, and the signal that lost the wake lands on it',
      Effect.fnUntraced(function* () {
        const { world, threadId, handle } = yield* opened(open);
        world.answers.push({ text: 'First.' }, { text: 'Second.' });
        const sent = yield* Effect.all(
          [
            handle.sendSignal({ ...REPORT, id: 'peer:a', text: 'alpha words' }),
            handle.sendSignal({ ...REPORT, id: 'peer:b', text: 'bravo words' }),
          ],
          { concurrency: 2 },
        );
        const wakes = sent.filter((result) => result.status === 'woken');
        expect(wakes).toHaveLength(1);
        const runId = wakes[0] !== undefined && 'runId' in wakes[0] ? wakes[0].runId : '';
        for (const result of sent) expect(result).toMatchObject({ runId });
        yield* until(() =>
          Effect.sync(() => {
            const requests = JSON.stringify(world.requests);
            return requests.includes('alpha words') && requests.includes('bravo words');
          }),
        );
        yield* quiet(world, threadId);
      }),
    );
    test(
      'a line that waits for the next turn opens none, the next line of its group takes it back, and that turn reads only the newer one',
      Effect.fnUntraced(function* () {
        const { world, threadId, handle } = yield* opened(open);
        const line = { type: 'child-agent-update', addressee: 'transport' } as const;
        const waits = { ifIdle: 'wait' } as const;
        yield* handle.sendSignal({ ...line, id: 'line:ran', text: 'the child ran' }, waits);
        expect(yield* handle.retractSignal('line:ran', () => Effect.void)).toBe(true);
        yield* handle.sendSignal({ ...line, id: 'line:cooled', text: 'the child cooled' }, waits);
        expect(world.requests).toEqual([]);
        world.answers.push({ text: 'Read it.' });
        yield* started(handle, 'Go on.');
        yield* quiet(world, threadId);
        const heard = JSON.stringify(world.requests);
        expect(world.requests).toHaveLength(1);
        expect(heard).toContain('the child cooled');
        expect(heard).not.toContain('the child ran');
      }),
    );
    test(
      'a compaction run and a keep-warm run read no words: a steer under either waits for the turn after it and is said once',
      Effect.fnUntraced(function* () {
        const stack = yield* opened(open);
        const { storage, world, threadId, handle } = stack;
        yield* seeded(stack);
        const pinged = hold();
        world.answers.push({ text: 'ok', held: pinged }, { text: 'Read after the ping.' });
        const ping = yield* handle.keepWarm(keepWarmSignalId({ anchor: 'anchor', ping: 1 }));
        expect(ping).toMatchObject({ status: 'woken' });
        yield* pinged.reached;
        const warm = 'runId' in ping ? ping.runId : '';
        expect(yield* handle.steer({ expectedRunId: warm, text: 'after the ping' })).toMatchObject({ status: 'queued', runId: warm });
        pinged.release();
        yield* until(() => Effect.sync(() => JSON.stringify(world.requests).includes('after the ping')));
        yield* quiet(world, threadId);
        const summary = hold();
        world.summaries.push({ summary: SUMMARY, held: summary });
        world.answers.push({ text: 'Read after the summary.' });
        const compacting = yield* handle.compact();
        expect(compacting).toMatchObject({ status: 'started' });
        yield* summary.reached;
        const compactionRun = 'runId' in compacting ? compacting.runId : '';
        expect(yield* handle.steer({ expectedRunId: compactionRun, text: 'after the summary' })).toMatchObject({
          status: 'queued',
          runId: compactionRun,
        });
        summary.release();
        yield* until(() => Effect.sync(() => JSON.stringify(world.requests).includes('after the summary')));
        yield* quiet(world, threadId);
        expect(yield* storage.inbox.pending(threadId)).toEqual([]);
        const said = (yield* transcriptOf(storage, threadId)).filter(entryOf('message')).filter((entry) => entry.role === 'user');
        expect(said.filter((entry) => entry.text === 'after the ping')).toHaveLength(1);
        expect(said.filter((entry) => entry.text === 'after the summary')).toHaveLength(1);
      }),
    );
  });
}
