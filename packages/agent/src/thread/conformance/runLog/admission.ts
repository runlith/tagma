import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Deferred, Effect, Fiber, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import type { AdmitCaller } from '../../keyed';
import { ThreadStorageFailed } from '../../persisted';
import { ThreadActReusedError } from '../../transition/port';
import { threadCauseOf } from '../../ThreadBorder';
import { ThreadBudgetSpentError } from '../../ThreadPorts';
import type { ThreadStorageFactory } from '../storagePort';
import { OWNER, SCOPE, openedRun, pump, scriptedWorld } from './world';
import { hangingTurn, replyTurn, scriptedStep } from './scripts';
import { until } from './support';
const DEALER: AdmitCaller = { kind: 'external', name: 'dealer' };
const reply = (id: string, text: string) =>
  replyTurn({
    chunks: [
      { type: 'text-start', id },
      { type: 'text-delta', id, text },
      { type: 'text-end', id },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
export function describeThreadAdmission<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: admit — one keyed act wakes a thread`, () => {
    test(
      'a send whose answer was lost, sent again under its key, answers the recorded receipt and opens no second run',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        world.plan.push(reply('a1', 'Dealt.'));
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const item = { kind: 'say', mode: 'send', text: 'Deal the next hand.' } as const;
        const first = yield* handle.admit(item, DEALER, 'deal-7');
        expect(first).toMatchObject({ status: 'woken', acted: true });
        const runId = first.runId;
        if (runId === null) return yield* Effect.die('A woken thread names its run.');
        expect(yield* handle.admit(item, DEALER, 'deal-7')).toEqual({ status: 'woken', runId, acted: false });
        yield* pump({ world, threadId: thread.id, runId, entry: { type: 'message', id: 'unused' } });
        expect(yield* handle.admit(item, DEALER, 'deal-7')).toEqual({ status: 'woken', runId, acted: false });
        const runs = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        expect(runs.map((run) => run.id)).toEqual([runId]);
      }),
    );
    test(
      'a key belongs to its caller: used at the same moment on two threads it is one act and a typed conflict',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const other = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        world.plan.push(reply('c1', 'First.'), reply('c2', 'Second.'));
        const item = { kind: 'say', mode: 'send', text: 'Deal the next hand.' } as const;
        const outcomes = yield* Effect.all(
          [
            Effect.result(world.harness.threads.handle(thread.id, OWNER).admit(item, DEALER, 'deal-both')),
            Effect.result(world.harness.threads.handle(other.id, OWNER).admit(item, DEALER, 'deal-both')),
          ],
          { concurrency: 2 },
        );
        const acted = outcomes.filter((outcome) => outcome._tag === 'Success').map((outcome) => outcome.success);
        const refused = outcomes.filter((outcome) => outcome._tag === 'Failure').map((outcome) => threadCauseOf(outcome.failure));
        expect(acted).toEqual([expect.objectContaining({ status: 'woken', acted: true })]);
        expect(refused).toEqual([expect.any(ThreadActReusedError)]);
        const observer = storage.runs({ ownerId: 'observer', scope: SCOPE });
        const runs = [...(yield* observer.runsOf(thread.id)), ...(yield* observer.runsOf(other.id))];
        expect(runs.map((run): string | null => run.id)).toEqual(acted.map((receipt) => receipt.runId));
      }),
    );
    test(
      'an envelope a send accepted with its wake, left undelivered, opens its recipient when the server comes back',
      Effect.fnUntraced(function* () {
        const storage = yield* Effect.acquireRelease(open(), (storage) => storage.dispose());
        const sender = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const recipient = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const id = `envelope:message:${sender.id}:send-1:0`;
        const now = yield* Clock.currentTimeMillis;
        yield* storage.inbox.control<null>(
          sender.id,
          {
            decide: () =>
              Effect.succeed({
                apply: Effect.fnUntraced(function* (writes) {
                  yield* writes.put({
                    id,
                    threadId: recipient.id,
                    sender: { kind: 'thread', threadId: sender.id, name: null },
                    kind: 'envelope',
                    body: { intent: 'message', text: 'Read the schema again.', inReplyTo: null },
                    occurredAt: new Date(now).toISOString(),
                  });
                  yield* writes.intendWake([id]);
                }),
                result: null,
              }),
          },
          {
            key: { evidence: { call: { namespace: `send:${sender.id}`, id: 'send-1' } }, digest: 'send-1' },
            deadline: new Date(now + 60_000),
          },
        );
        const world = yield* scriptedWorld(storage, recipient.agentId);
        world.plan.push(reply('w1', 'Read.'));
        yield* until(() => Effect.map(storage.inbox.pendingWakes(10), (wakes) => wakes.length === 0));
        expect((yield* storage.inbox.receipt(id))?.state).not.toBe('queued');
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(recipient.id)).toHaveLength(1);
      }),
    );
    test(
      'a turn its spent budget refuses opens no run, and the same key replays the refusal after the budget moves',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        yield* storage.aggregate.update(thread.id, { budgetTokens: 0 });
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const item = { kind: 'say', mode: 'send', text: 'Spend some more.' } as const;
        expect(threadCauseOf(yield* Effect.flip(handle.admit(item, DEALER, 'spend-1')))).toBeInstanceOf(ThreadBudgetSpentError);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id)).toEqual([]);
        yield* storage.aggregate.update(thread.id, { budgetTokens: null });
        expect(threadCauseOf(yield* Effect.flip(handle.admit(item, DEALER, 'spend-1')))).toBeInstanceOf(ThreadBudgetSpentError);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id)).toEqual([]);
      }),
    );
    test(
      'a send that committed and then died before answering, sent again under its key, answers the run it opened and opens no second',
      Effect.fnUntraced(function* () {
        const crashed = { armed: false };
        const { storage, world, thread } = yield* openedRun(
          Effect.fnUntraced(function* () {
            const storage = yield* open();
            const eventLog = Object.create(storage.eventLog, {
              headPosition: {
                value: (...args: Parameters<typeof storage.eventLog.headPosition>) => {
                  if (!crashed.armed) return storage.eventLog.headPosition(...args);
                  crashed.armed = false;
                  return Effect.fail(
                    new ThreadStorageFailed({ call: 'headPosition', cause: new Error('The process died after the commit.') }),
                  );
                },
              },
            }) as typeof storage.eventLog;
            return { ...storage, eventLog };
          }),
        );
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const item = { kind: 'say', mode: 'send', text: 'Deal once.' } as const;
        crashed.armed = true;
        expect(yield* Effect.flip(handle.admit(item, DEALER, 'deal-9'))).toBeInstanceOf(ThreadStorageFailed);
        const [opened] = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        if (opened === undefined) return yield* Effect.die('The send committed its run before it died.');
        expect(yield* handle.admit(item, DEALER, 'deal-9')).toEqual({ status: 'woken', runId: opened.id, acted: false });
        const runs = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        expect(runs.map((run) => run.id)).toEqual([opened.id]);
      }),
    );
    test(
      'a resend racing the first send from another process replays the run that send opened, writes no words of its own, and refuses other words',
      Effect.fnUntraced(function* () {
        const { storage, world, thread } = yield* openedRun(open);
        const going = yield* Deferred.make<void>();
        world.plan.push(
          hangingTurn({ chunks: [{ type: 'text-start', id: 'r1' }], reached: () => Deferred.doneUnsafe(going, Effect.void) }),
        );
        const item = { kind: 'say', mode: 'send', text: 'Deal the race.' } as const;
        const first = yield* world.harness.threads.handle(thread.id, OWNER).admit(item, DEALER, 'deal-race');
        yield* Deferred.await(going);
        const stale = Object.create(storage.transitions, {
          readRecord: {
            value: (...args: Parameters<typeof storage.transitions.readRecord>) =>
              args[2] === undefined ? Effect.succeed({ kind: 'absent' as const }) : storage.transitions.readRecord(...args),
          },
        }) as typeof storage.transitions;
        const racing = yield* scriptedWorld({ ...storage, transitions: stale }, thread.agentId);
        const second = racing.harness.threads.handle(thread.id, OWNER);
        expect(yield* second.admit(item, DEALER, 'deal-race')).toEqual({ status: 'woken', runId: first.runId, acted: false });
        expect(yield* Effect.flip(second.admit({ ...item, text: 'Deal it twice.' }, DEALER, 'deal-race'))).toBeInstanceOf(
          ThreadActReusedError,
        );
        expect((yield* storage.inbox.pending(thread.id)).filter((pending) => pending.state === 'queued')).toEqual([]);
        yield* racing.dispose();
        yield* world.harness.threads.handle(thread.id, OWNER).stop();
      }),
    );
    test(
      'a compaction that committed its opening and then died leaves its run with its entry, and the same start key answers that run',
      Effect.fnUntraced(function* () {
        const crashed = { armed: false };
        const { storage, world, thread } = yield* openedRun(
          Effect.fnUntraced(function* () {
            const storage = yield* open();
            const eventLog = Object.create(storage.eventLog, {
              headPosition: {
                value: (...args: Parameters<typeof storage.eventLog.headPosition>) => {
                  if (!crashed.armed) return storage.eventLog.headPosition(...args);
                  crashed.armed = false;
                  return Effect.fail(
                    new ThreadStorageFailed({ call: 'headPosition', cause: new Error('The process died after the commit.') }),
                  );
                },
              },
            }) as typeof storage.eventLog;
            return { ...storage, eventLog };
          }),
        );
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const ask = { startKey: { key: 'compact-1', digest: 'compact-1' } };
        crashed.armed = true;
        expect(yield* Effect.flip(handle.compact(ask))).toBeInstanceOf(ThreadStorageFailed);
        const [opened] = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        if (opened === undefined) return yield* Effect.die('The compaction committed its run before it died.');
        const entries = (yield* storage.aggregate.transcriptOf(thread.id)) ?? [];
        expect(
          entries
            .filter((entry) => entry.type === 'compaction')
            .map(
              (entry) =>
                (
                  entry as {
                    runId?: string;
                  }
                ).runId,
            ),
        ).toEqual([opened.id]);
        expect(yield* handle.compact(ask)).toEqual({ status: 'started', runId: opened.id });
        const runs = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runsOf(thread.id);
        expect(runs.map((run) => run.id)).toEqual([opened.id]);
      }),
    );
    test(
      'the same key carrying other words is a typed conflict, and another caller owns its own keys',
      Effect.fnUntraced(function* () {
        const { world, thread } = yield* openedRun(open);
        world.plan.push(reply('b1', 'Dealt.'));
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const first = yield* handle.admit({ kind: 'say', mode: 'send', text: 'Deal.' }, DEALER, 'deal-1');
        expect(yield* Effect.flip(handle.admit({ kind: 'say', mode: 'send', text: 'Deal twice.' }, DEALER, 'deal-1'))).toBeInstanceOf(
          ThreadActReusedError,
        );
        const other = yield* handle.admit({ kind: 'say', mode: 'send', text: 'Deal.' }, { kind: 'external', name: 'observer' }, 'deal-1');
        expect(other.acted).toBe(true);
        expect(other.runId).toBe(first.runId);
      }),
    );
    test(
      'queued and steered inputs keep their client keys: a resend answers the recorded outcome, the status carries one receipt each, nothing doubles',
      Effect.fnUntraced(function* () {
        const { world, thread } = yield* openedRun(open);
        const reached = yield* Deferred.make<void>();
        world.plan.push(
          hangingTurn({
            chunks: [
              { type: 'text-start', id: 'h1' },
              { type: 'text-delta', id: 'h1', text: 'Working' },
            ],
            reached: () => Deferred.doneUnsafe(reached, Effect.void),
          }),
        );
        const handle = world.harness.threads.handle(thread.id, OWNER);
        const started = yield* handle.send('Start something long.', undefined, { key: 'send-1' });
        if (started.status !== 'started') return yield* Effect.die(`The opening words answered ${started.status}.`);
        const pumping = yield* Effect.forkScoped(pump({ world, threadId: thread.id, runId: started.runId, entry: started.entry }));
        yield* Deferred.await(reached);
        const queued = yield* handle.queue('Then write the note.', undefined, { key: 'queue-1' });
        expect(queued).toMatchObject({ status: 'queued', runId: started.runId });
        expect(yield* handle.queue('Then write the note.', undefined, { key: 'queue-1' })).toEqual({ ...queued, replayed: true });
        const steer = { expectedRunId: started.runId, text: 'Use the other table.' };
        const steered = yield* handle.steer(steer, { key: 'steer-1' });
        if (steered.status !== 'steered') return yield* Effect.die(`The steer answered ${steered.status} instead of steering the run.`);
        expect(steered).toEqual({ status: 'steered', runId: started.runId, itemId: steered.itemId });
        expect((yield* world.harness.reads.snapshot(thread.id)).pendingInput.steers.map((row) => row.id)).toEqual([steered.itemId]);
        expect(yield* handle.steer(steer, { key: 'steer-1' })).toEqual({ ...steered, replayed: true });
        expect(yield* handle.steer({ expectedRunId: 'run-nobody-has', text: 'Kept anyway.' }, { key: 'steer-2' })).toMatchObject({
          status: 'queued',
          runId: started.runId,
        });
        expect(yield* Effect.flip(handle.steer({ expectedRunId: started.runId, text: 'Too late.' }, { key: 'steer-2' }))).toBeInstanceOf(
          ThreadActReusedError,
        );
        const snapshot = yield* world.harness.reads.snapshot(thread.id);
        expect(snapshot.pendingInput.queued).toHaveLength(2);
        expect(snapshot.pendingInput.steers).toHaveLength(1);
        expect(snapshot.status.receipts.map((receipt) => [receipt.key, receipt.status, receipt.runId])).toEqual([
          ['queue-1', 'queued', started.runId],
          ['steer-2', 'queued', started.runId],
          ['steer-1', 'steered', started.runId],
        ]);
        world.plan.push(reply('f1', 'Reported.'));
        expect(yield* handle.stop()).toMatchObject({ status: 'stopped' });
        yield* Fiber.join(pumping);
      }),
    );
    test(
      'statuses answers one row per named thread, and a missing or foreign one answers its own typed outcome',
      Effect.fnUntraced(function* () {
        const { world, thread } = yield* openedRun(open);
        const rows = yield* world.harness.reads.statuses(OWNER, [thread.id, 'ghost']);
        expect(rows.map((row) => [row.threadId, row.outcome])).toEqual([
          [thread.id, 'found'],
          ['ghost', 'not-found'],
        ]);
        expect(rows[0]).toMatchObject({ status: { threadId: thread.id, runId: null, life: 'idle', receipts: [] } });
        expect((yield* world.harness.reads.statuses('somebody-else', [thread.id]))[0]).toEqual({
          threadId: thread.id,
          outcome: 'foreign-owner',
        });
      }),
    );
  });
}
