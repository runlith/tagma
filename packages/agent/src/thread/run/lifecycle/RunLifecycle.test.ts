import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Cause, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { InvalidRequestReason, LLMError } from '@runlith/llm/schema/errors';
import { Message } from '@runlith/llm/schema/messages';
import type { ThreadMessageEntry } from '../../../transcript/entries';
import { ModelRuns } from '../../ThreadPorts';
import { makeAggregateStorage } from '../../storage/InMemoryAggregateStorage';
import { THREAD_RUN_AWAITING_QUESTION_STAGE, type ThreadAbandonedRun, type ThreadRunStartFrom } from '../../storage/runs';
import type { ThreadRunStopRequest } from '../../storage/settlement';
import { ThreadStorageFailed } from '../../persisted';
import type { ThreadJournalLaneFaces } from '../../transition/lane';
import { ThreadCallBroke } from '../../ThreadBorder';
import { ThreadTailLostError } from '../../ThreadFailure';
import { lifecycleWorld } from '../../conformance/runCycle/lifecycle';
import { runRow } from '../../conformance/runCycle/runDoubles';
import { runStore } from '../../conformance/runCycle/store';
import type { RunFinish } from './RunLifecycle';
const runRef = { id: 'run-1', threadId: 'thread-1' };
const startFrom: ThreadRunStartFrom = {
  id: runRef.threadId,
  ownerId: 'test-owner',
  account: null,
  provider: 'test-provider',
  model: null,
  reasoning: null,
  switches: {},
};
const approval = { mode: 'trust' as const, interactive: false };
const broke = (cause: unknown): RunFinish => ({ kind: 'broke', cause: Cause.fail(cause), departing: false });
const request = (by: ThreadRunStopRequest['by']): ThreadRunStopRequest => ({
  by,
  marker: false,
  withdraw: false,
  at: new Date(0).toISOString(),
});
const candidate = (id: string, gapMs: number): ThreadAbandonedRun => ({
  id,
  threadId: 'thread-1',
  kind: 'turn',
  gapMs,
  selector: { kind: 'handed-over' },
  resumeLimit: 1,
  stopRequest: null,
});
const userMessage = (runId: string): ThreadMessageEntry => ({
  type: 'message',
  id: 'message-1',
  runId,
  role: 'user',
  text: 'Hold that thought.',
});
const catalogsFixture = () => {
  let current = 'first';
  const held = new Map<string, string>();
  const catalogs = ModelRuns.of({
    admit: (id) => {
      if (!held.has(id)) held.set(id, current);
    },
    release: (id) =>
      Effect.sync(() => {
        held.delete(id);
      }),
  });
  return {
    catalogs,
    held,
    move: (next: string) => {
      current = next;
    },
  };
};
describe('RunLifecycle', () => {
  it.effect(
    'admission holds the model catalog through parking and releases it when the run ends',
    Effect.fnUntraced(function* () {
      const catalogs = catalogsFixture();
      const { runs, rows } = runStore([]);
      const { lifecycle } = yield* lifecycleWorld(runs, { catalogs: catalogs.catalogs });
      const start = yield* lifecycle.create(startFrom, approval, { kind: 'turn' });
      catalogs.move('second');
      expect(catalogs.held.get(start.run.id)).toBe('first');
      expect(yield* lifecycle.park(runRef)).toBe('parked');
      expect(catalogs.held.get(start.run.id)).toBe('first');
      expect(rows.get(start.run.id)?.progress.stage).toBe(THREAD_RUN_AWAITING_QUESTION_STAGE);
      yield* lifecycle.resume(start.run.threadId, start.run.id);
      yield* lifecycle.finish(runRef, { kind: 'completed' });
      expect(rows.get(start.run.id)?.status).toBe('completed');
      expect(catalogs.held.size).toBe(0);
    }),
  );
  it.effect(
    'transactional admission holds a catalog after commit and never after rollback',
    Effect.fnUntraced(function* () {
      const catalogs = catalogsFixture();
      const { runs, rows } = runStore([]);
      const { lifecycle, aggregate } = yield* lifecycleWorld(runs, { catalogs: catalogs.catalogs });
      yield* aggregate.writeAt(
        runRef.threadId,
        Effect.fnUntraced(function* ({ tx }) {
          yield* lifecycle.create(startFrom, approval, { kind: 'compaction', tx });
          expect(catalogs.held.size).toBe(0);
          catalogs.move('second');
        }),
      );
      expect(catalogs.held.get(runRef.id)).toBe('second');
      const rollback = new ThreadStorageFailed({ call: 'admission', cause: new Error('The admission did not commit.') });
      expect(
        yield* Effect.flip(
          aggregate.writeAt(
            'other-thread',
            Effect.fnUntraced(function* ({ tx }) {
              yield* lifecycle.create({ ...startFrom, id: 'other-thread' }, approval, { kind: 'compaction', runId: 'rolled-back', tx });
              return yield* rollback;
            }),
          ),
        ),
      ).toBe(rollback);
      expect(rows.has('rolled-back')).toBe(false);
      expect(catalogs.held.has('rolled-back')).toBe(false);
    }),
  );
  it.effect(
    'a terminal record keeps the whole-run interval and a lost settlement cannot duplicate it',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const { lifecycle, journal, aggregate } = yield* lifecycleWorld(runs);
      yield* TestClock.adjust(1_000);
      expect(yield* lifecycle.finish(runRef, { kind: 'completed' })).toBe('committed');
      expect(rows.get(runRef.id)?.finishedAt?.getTime()).toBe(1_000);
      expect(rows.get(runRef.id)?.heartbeatAt.getTime()).toBe(1_000);
      expect(journal.rows.find((row) => row.kind === 'run-end')?.payload.entry).toMatchObject({
        type: 'run-end',
        id: 'run-end:run-1',
        runId: 'run-1',
        status: 'completed',
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1_000).toISOString(),
      });
      expect(aggregate.history).toEqual([]);
      expect(yield* lifecycle.finish(runRef, { kind: 'completed' })).not.toBe('committed');
      expect(journal.rows.filter((row) => row.kind === 'run-end')).toHaveLength(1);
    }),
  );
  it.effect(
    'the run, thread status and terminal journal roll back together when the thread mark fails',
    Effect.fnUntraced(function* () {
      const { runs, rows, threadStatus, faults } = runStore();
      const { lifecycle, journal } = yield* lifecycleWorld(runs);
      const failure = new ThreadStorageFailed({ call: 'markStatus', cause: new Error('The thread mark failed.') });
      faults.mark = failure;
      expect(yield* Effect.flip(lifecycle.finish(runRef, { kind: 'completed' }))).toBe(failure);
      expect(rows.get(runRef.id)?.status).toBe('running');
      expect(threadStatus.has(runRef.threadId)).toBe(false);
      expect(journal.rows).toEqual([]);
      faults.mark = null;
      expect(yield* lifecycle.finish(runRef, { kind: 'completed' })).toBe('committed');
      expect(rows.get(runRef.id)?.status).toBe('completed');
      expect(threadStatus.get(runRef.threadId)).toBe('idle');
      expect(journal.rows.filter((row) => row.kind === 'run-end')).toHaveLength(1);
    }),
  );
  for (const admission of ['refused', 'none', 'uncertain'] as const) {
    it.effect(
      `a broken ending whose journal lane answers ${admission} leaves the run intact`,
      Effect.fnUntraced(function* () {
        const { runs, rows } = runStore();
        const refused = new ThreadStorageFailed({ call: 'journal.open', cause: new Error('The rollout is ahead of the log.') });
        const lane: ThreadJournalLaneFaces = {
          place: () => ({ at: 1 }),
          enter: () => (admission === 'refused' ? Effect.fail(refused) : Effect.succeed({ stalled: admission })),
          order: (_threadId, work) => work,
        };
        const { lifecycle, journal } = yield* lifecycleWorld(runs, { lane });
        const failure = yield* Effect.flip(lifecycle.finish(runRef, broke(new Error('opening failed'))));
        expect(failure).toBeInstanceOf(ThreadStorageFailed);
        if (admission === 'refused') expect(failure).toBe(refused);
        else expect(failure).toMatchObject({ call: 'run.end' });
        expect(rows.get(runRef.id)?.status).toBe('running');
        expect(journal.rows).toEqual([]);
      }),
    );
  }
  it.effect(
    'a provider failure settles into the run row and transcript with one typed safe summary',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow(runRef.id, { provider: 'subscription' })]);
      const { lifecycle, journal } = yield* lifecycleWorld(runs);
      const failure = new LLMError({
        module: 'RequestExecutor',
        method: 'execute',
        reason: new InvalidRequestReason({
          message: 'Anthropic HTTP 400: input_schema does not support anyOf at the top level.',
          http: {
            request: { method: 'POST', url: 'https://api.anthropic.com/v1/messages', headers: {} },
            response: { status: 400, headers: { 'request-id': 'req-safe' } },
            body: '{"type":"invalid_request_error"}',
            requestId: 'req-safe',
          },
        }),
      });
      yield* lifecycle.finish(runRef, broke(new ThreadCallBroke({ cause: failure })));
      expect(rows.get(runRef.id)?.failure).toMatchObject({
        provider: 'subscription',
        stage: 'RequestExecutor.execute',
        type: 'InvalidRequest',
        httpStatus: 400,
        retryable: false,
        modelStarted: false,
        record: { threadId: runRef.threadId, runId: runRef.id, entryId: 'transcript:error:run-1' },
      });
      expect(journal.rows.find((row) => row.kind === 'failure')?.payload.entry).toMatchObject({
        type: 'failure',
        id: 'transcript:error:run-1',
      });
    }),
  );
  it.effect(
    'a recorded stop aborts a broken run, an ordinary failure fails it, and departure leaves it running',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow(runRef.id, { stopRequest: request('parent') }), runRow('run-2', { threadId: 'thread-2' })]);
      const { lifecycle } = yield* lifecycleWorld(runs);
      expect(yield* lifecycle.finish(runRef, broke(new Error('interrupted')))).toBe('committed');
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'parent' });
      const other = { id: 'run-2', threadId: 'thread-2' };
      expect(yield* lifecycle.finish(other, { kind: 'broke', cause: Cause.fail(new Error('host left')), departing: true })).toBe('left');
      expect(rows.get(other.id)?.status).toBe('running');
      expect(yield* lifecycle.finish(other, broke(new Error('the turn blew up')))).toBe('committed');
      expect(rows.get(other.id)?.status).toBe('failed');
    }),
  );
  it.effect(
    'a late end of an earlier turn cannot free the seat of the following turn',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([]);
      const { lifecycle, seats, aggregate } = yield* lifecycleWorld(runs);
      const child = { ...aggregate.row(runRef.threadId), parentThreadId: 'root' };
      yield* seats.admit(child);
      const first = yield* lifecycle.create(startFrom, approval, { kind: 'turn' });
      rows.set(first.run.id, { ...first.run, status: 'completed' });
      yield* lifecycle.create(startFrom, approval, { kind: 'turn', runId: 'run-2' });
      yield* lifecycle.finish(runRef, broke(new Error('the earlier turn ended late')));
      expect(seats.resident()).toBe(1);
      expect(yield* Effect.flip(seats.admit({ ...child, id: 'thread-2' }))).toMatchObject({ _tag: 'ThreadCallBroke' });
      yield* lifecycle.finish({ ...runRef, id: 'run-2' }, broke(new Error('the next turn ended')));
      expect(seats.resident()).toBe(0);
    }),
  );
  it.effect(
    'a stopped run that lost its last output stays aborted and keeps the typed loss',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow(runRef.id, { stopRequest: request('reader') })]);
      const { lifecycle } = yield* lifecycleWorld(runs);
      expect(yield* lifecycle.finish(runRef, broke(new ThreadTailLostError(new Error('event page write lost'))))).toBe('committed');
      expect(rows.get(runRef.id)).toMatchObject({ status: 'aborted', settledBy: 'reader', failure: { type: 'ThreadTailLostError' } });
    }),
  );
  it.effect(
    'a cut closes a tool whose input was still streaming and preserves its display data',
    Effect.fnUntraced(function* () {
      const old = runRow('run-old', {
        ownerId: 'departed',
        handedOverAt: new Date(0),
        streamTail: [
          {
            type: 'tool',
            id: 'tool:call-2',
            runId: 'run-old',
            toolName: 'spawn_agent',
            toolCallId: 'call-2',
            toolState: 'input-streaming',
            toolInput: { agentId: 'tagma' },
            toolDisplay: { form: 'none', title: 'build-store' },
          },
        ],
      });
      const { runs, rows } = runStore([old]);
      const { lifecycle, journal } = yield* lifecycleWorld(runs);
      expect(yield* lifecycle.cut(candidate(old.id, 90 * 60_000))).toBe('committed');
      expect(rows.get(old.id)?.status).toBe('cut');
      expect(journal.rows.filter((row) => row.kind === 'tool').map((row) => row.payload.entry)).toMatchObject([
        { toolState: 'input-streaming' },
        { toolState: 'input-interrupted', toolDisplay: { title: 'build-store' } },
      ]);
    }),
  );
  it.effect(
    'a cut writes its marker even with nothing left in the tail',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow('run-old', { ownerId: 'departed', handedOverAt: new Date(0) })]);
      const { lifecycle, journal } = yield* lifecycleWorld(runs);
      expect(yield* lifecycle.cut(candidate('run-old', 90 * 60_000))).toBe('committed');
      expect(rows.get('run-old')?.status).toBe('cut');
      expect(journal.rows.find((row) => row.kind === 'interruption')?.payload.entry).toMatchObject({
        type: 'interruption',
        runId: 'run-old',
      });
    }),
  );
  it.effect(
    'a stopped run that never answered gives its turn back',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const aggregate = makeAggregateStorage({ transcript: [userMessage(runRef.id)] });
      aggregate.history = [Message.make({ role: 'user', content: 'Hold that thought.' })];
      const { lifecycle, journal } = yield* lifecycleWorld(runs, { aggregate });
      expect(yield* lifecycle.stop(runRef, { marker: true, by: 'reader', withdraw: true }, false)).toBe('stopped');
      expect(journal.rows.find((row) => row.kind === 'withdrawal')?.payload.withdrawn).toEqual({ runId: runRef.id, keepMessages: 0 });
      expect(aggregate.transcript).toEqual([]);
      expect(rows.get(runRef.id)?.status).toBe('withdrawn');
      expect(journal.rows.some((row) => row.kind === 'run-end')).toBe(false);
    }),
  );
  it.effect(
    'a run steered mid-turn keeps the turn it was written against',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore();
      const aggregate = makeAggregateStorage({
        transcript: [userMessage(runRef.id), { ...userMessage(runRef.id), id: 'message-2', text: 'And this.' }],
      });
      aggregate.history = [Message.make({ role: 'user', content: 'Hold that thought.' })];
      const { lifecycle, journal } = yield* lifecycleWorld(runs, { aggregate });
      expect(yield* lifecycle.stop(runRef, { marker: true, by: 'reader', withdraw: true }, false)).toBe('stopped');
      expect(journal.rows.some((row) => row.kind === 'withdrawal')).toBe(false);
      expect(rows.get(runRef.id)?.status).toBe('aborted');
      expect(journal.rows.filter((row) => row.kind === 'run-end')).toHaveLength(1);
    }),
  );
  it.effect(
    'an ended run answers a second stop and finish as not running and publishes its ending once',
    Effect.fnUntraced(function* () {
      const { runs } = runStore();
      const { lifecycle, settlements } = yield* lifecycleWorld(runs);
      const settled: string[] = [];
      yield* settlements.subscribe({
        name: 'suite',
        handle: (event) =>
          Effect.sync(() => {
            settled.push(event.runId);
          }),
      });
      const intent = { marker: true, by: 'reader' as const, withdraw: false };
      expect(yield* lifecycle.stop(runRef, intent, false)).toBe('stopped');
      expect(yield* lifecycle.stop(runRef, intent, false)).toBe('not-running');
      expect(yield* lifecycle.finish(runRef, { kind: 'completed' })).toBe('not-running');
      expect(settled).toEqual([runRef.id]);
    }),
  );
  it.effect(
    'finish refuses a parked run and reap refuses a foreign or live run, naming the state',
    Effect.fnUntraced(function* () {
      const { runs, rows } = runStore([runRow(runRef.id, { progress: { stage: THREAD_RUN_AWAITING_QUESTION_STAGE, message: null } })]);
      const { lifecycle } = yield* lifecycleWorld(runs);
      expect(yield* Effect.flip(lifecycle.finish(runRef, { kind: 'completed' }))).toMatchObject({
        _tag: 'RunActRefused',
        act: 'finish',
        state: 'parked',
      });
      expect(yield* Effect.flip(lifecycle.reap(candidate(runRef.id, 60_000), 'gone', false))).toMatchObject({
        act: 'reap',
        state: 'foreign',
      });
      const stale = { ...candidate(runRef.id, 60_000), selector: { kind: 'stale-heartbeat' as const, heartbeatBefore: new Date(0) } };
      expect(yield* Effect.flip(lifecycle.reap(stale, 'gone', true))).toMatchObject({ act: 'reap', state: 'live' });
      expect(rows.get(runRef.id)?.status).toBe('running');
    }),
  );
});
