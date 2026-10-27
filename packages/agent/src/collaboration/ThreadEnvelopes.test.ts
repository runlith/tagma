import { describe, expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Queue } from 'effect';
import { TestClock } from 'effect/testing';
import { ActivityLog } from '@runlith/activity/log';
import { activityRecording } from '@runlith/activity/testing';
import { modelCatalog } from '@runlith/llm/models/catalog';
import { DEFAULT_PROVIDER_DESCRIPTIONS } from '@runlith/builtin-catalog/descriptions';
import { NATIVE_CAPABILITIES, type ThreadRecord } from '../thread/record';
import { EndingStages, type RunEnded } from '../thread/ending';
import type { ThreadSignal } from '../transcript/parts';
import { makeThreadEntryReader } from '../transcript/kinds';
import type { Keyed } from '../thread/keyed';
import type { InboxPlan, ThreadInboxItem, ThreadInputAcceptance } from '../thread/storage/inbox';
import {
  barrierIdAhead,
  behindBarrier,
  behindBarrierId,
  carriesWords,
  inboxCompactionValues,
  threadSignalOfInboxItem,
} from '../thread/inboxItems';
import { MemoryTx } from '../thread/storage/memory/units';
import { ThreadInbox, ThreadOwnWork, ThreadResting, type ThreadWriteTx } from '../thread/ThreadPorts';
import { storageFailed } from '../thread/ThreadBorder';
import { threadStorageLayer } from '../thread/kernelPorts';
import { ThreadMemory } from '../thread/storage/memory/state';
import { makeMemoryRows } from '../thread/storage/memory/ThreadRows';
import { makeMemoryEvents } from '../thread/storage/memory/ThreadEvents';
import { makeMemoryRuns } from '../thread/storage/memory/ThreadRuns';
import { makeMemoryOwnerSettings } from '../thread/storage/memory/OwnerSettings';
import { inMemoryThreadTransitions } from '../thread/storage/memory/ThreadTransitions';
import { inMemoryInboxStorage } from '../thread/storage/InMemoryInboxStorage';
import { inMemoryEndingStages } from '../thread/storage/InMemoryEndingStages';
import { emptyToolOutputs, runRow } from '../thread/conformance/runCycle/runDoubles';
import { lifecycleWorld } from '../thread/conformance/runCycle/lifecycle';
import { runStore } from '../thread/conformance/runCycle/store';
import { makeAggregateStorage } from '../thread/storage/InMemoryAggregateStorage';
import { ThreadChanges, threadChangesLayer } from '../thread/run/ThreadChanges';
import { DeclaredCollaboration } from './CollaborationConfig';
import { ContextCompaction } from './compaction';
import { ThreadRunUnavailable, ThreadRuns } from './runs';
import { ThreadDirectory, type ThreadDirectoryEntry } from './ThreadDirectory';
import { ThreadEnvelopes, threadEnvelopesLayer } from './ThreadEnvelopes';
import { threadEnvelopeId, threadReportEnvelopeId } from './envelopeKeys';
import { spawnRequestId } from './births';
import { planeRefusalOf } from './planeRefusal';
import { type ThreadDirectoryRow, Threads } from './threads';
import type { ColdWakeRule } from './wakeCost';
import type { ThreadCacheWarmth } from '../thread/cache/ThreadCacheWarmth';
import type { ThreadContextReading } from '../thread/rows';
import { agentSignalMarkup } from '../agent/AgentSignal';
const unused = () => Effect.die('This envelope contract does not use this operation');
const fixtureModel = modelCatalog(DEFAULT_PROVIDER_DESCRIPTIONS)
  .modelsByCapability('text')
  .find((option) => option.defaultReasoning !== null)!;
const fixtureSelection = { provider: fixtureModel.provider, model: fixtureModel.id, reasoning: fixtureModel.defaultReasoning };
const OWN_ENDING = 'command-result';
describe('ThreadEnvelopes completion routing', () => {
  it.effect(
    'one run answers its spawn and peer task requesters',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn:call-1', h.source.id, h.parent.id, 'run-handled');
      yield* h.task('envelope:peer:call-2', h.source.id, h.peer.id, 'run-handled');
      yield* h.complete(completed('run-handled', h.source.id));
      expect(h.sent.map((delivery) => delivery.recipient.id).sort()).toEqual([h.parent.id, h.peer.id]);
      expect(h.row('envelope:report:envelope:spawn:call-1:run-handled')).toMatchObject({
        threadId: h.parent.id,
        kind: 'envelope',
        body: { intent: 'report', inReplyTo: 'envelope:spawn:call-1' },
      });
      expect(h.row('envelope:report:envelope:peer:call-2:run-handled')).toMatchObject({
        threadId: h.peer.id,
        kind: 'envelope',
        body: { intent: 'report', inReplyTo: 'envelope:peer:call-2' },
      });
      expect(h.row('envelope:spawn:call-1')).toMatchObject({ state: 'acknowledged' });
      expect(h.row('envelope:peer:call-2')).toMatchObject({ state: 'acknowledged' });
    }),
  );
  it.effect(
    'a successor opening before publication cannot replace the completed task answer',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const run = { id: 'run-answered', threadId: h.source.id };
      const task = 'envelope:spawn:call-1';
      yield* h.task(task, h.source.id, h.parent.id, run.id);
      const answer = 'Findings: the probe held.\n\nThe report contains every measurement.';
      const aggregate = makeAggregateStorage({
        transcript: [{ type: 'message', id: 'answer', role: 'assistant', runId: run.id, text: answer }],
      });
      const { runs } = runStore([runRow(run.id, { threadId: run.threadId })]);
      const world = yield* lifecycleWorld(runs, { aggregate, inbox: h.inbox, endings: h.endings });
      const endings = Context.get(world.context, EndingStages);
      yield* world.settlements.subscribe({
        name: 'successor before report',
        handle: Effect.fnUntraced(function* () {
          yield* h.carry(run.id, 'run-later');
          yield* h.complete(completed('run-later', h.source.id), { answer: 'Classification received.' });
          const captured = yield* endings.read(run.id);
          if (captured === null) return yield* Effect.die('The completed task left no ending.');
          yield* h.complete(completed(run.id, h.source.id), { ...captured.ended, principal: h.source.principal });
        }, Effect.orDie),
      });
      yield* world.lifecycle.finish(run, { kind: 'completed' });
      expect(h.row(task)).toMatchObject({ state: 'acknowledged', deliveredToRunId: run.id });
      expect(h.reports()).toHaveLength(1);
      expect(h.sent.map((delivery) => delivery.signal.text.endsWith(answer))).toEqual([true]);
    }),
  );
  it.effect(
    'a fallback waits on a compact task whose ending has not reported yet, and the run that reads its report sends it once',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const task = 'envelope:spawn:call-1';
      const sent = threadEnvelopeId('task', h.source.id, 'review', 0);
      const review = behindBarrierId(barrierIdAhead({ id: sent }), sent);
      yield* h.task(task, h.source.id, h.parent.id, 'run-asked');
      yield* h.task(review, h.peer.id, h.source.id, 'run-review');
      yield* h.ledger.acknowledge([review], 'run-review');
      yield* h.pend('run-review', h.peer.id);
      const answers = () => h.reports().filter((report) => report.threadId === h.parent.id);
      yield* h.complete(completed('run-asked', h.source.id), { answer: 'Waiting for the review.' });
      expect(answers()).toEqual([]);
      expect(h.recording.runNotes('run-asked')).toEqual([
        { type: 'run-reporting', requests: 1, fallbacks: 0, diagnoses: 0, held: 1, closed: 0 },
      ]);
      yield* h.report(threadReportEnvelopeId(review, 'run-review'), h.source.id, h.peer.id, 'run-done');
      yield* h.complete(completed('run-done', h.source.id), { answer: 'DONE: reviewed.' });
      yield* h.complete(completed('run-after', h.source.id), { answer: 'Chatting on.' });
      expect(answers().map((report) => report.id)).toEqual([threadReportEnvelopeId(task, 'run-asked')]);
      expect(answers()[0]?.body.text).toContain('DONE: reviewed.');
    }),
  );
  it.effect(
    'a fallback waits on a command of its own still running or its ending still unread, and the run that reads the ending sends it once',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const task = 'envelope:spawn:call-1';
      const ending = 'command:exec-tests:1:call-tests';
      yield* h.task(task, h.source.id, h.parent.id, 'run-asked');
      const answers = () => h.reports().filter((report) => report.threadId === h.parent.id);
      h.owing.add(h.source.id);
      yield* h.complete(completed('run-asked', h.source.id), { answer: 'The tests run in the background.' });
      expect(answers()).toEqual([]);
      expect(h.recording.runNotes('run-asked')).toEqual([
        { type: 'run-reporting', requests: 1, fallbacks: 0, diagnoses: 0, held: 1, closed: 0 },
      ]);
      h.owing.delete(h.source.id);
      yield* h.ledger.put({
        id: ending,
        threadId: h.source.id,
        sender: { kind: 'host' },
        kind: 'signal',
        body: { type: OWN_ENDING, addressee: 'transport', text: 'A command you left running has ended: completed, exit 0.' },
        occurredAt: '2026-08-31T20:10:00.000Z',
      });
      yield* h.complete(completed('run-between', h.source.id), { answer: 'Noted the question.' });
      expect(answers()).toEqual([]);
      yield* h.ledger.deliver([ending], 'run-done');
      yield* h.ledger.acknowledge([ending], 'run-done');
      yield* h.complete(completed('run-done', h.source.id), { answer: 'DONE: the tests passed.' });
      expect(answers().map((report) => report.id)).toEqual([threadReportEnvelopeId(task, 'run-asked')]);
      expect(answers()[0]?.body.text).toContain('DONE: the tests passed.');
    }),
  );
  it.effect(
    'a run that read the ending of its own command answers before the taking run reports, and the taking run then sends nothing',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const task = 'envelope:spawn:call-1';
      const ending = 'command:exec-tests:1:call-tests';
      yield* h.task(task, h.source.id, h.parent.id, 'run-asked');
      yield* h.ledger.acknowledge([task], 'run-asked');
      yield* h.pend('run-asked', h.source.id);
      yield* h.ledger.put({
        id: ending,
        threadId: h.source.id,
        sender: { kind: 'host' },
        kind: 'signal',
        body: { type: OWN_ENDING, addressee: 'transport', text: 'A command you left running has ended: completed, exit 0.' },
        occurredAt: '2026-08-31T20:10:00.000Z',
      });
      yield* h.ledger.deliver([ending], 'run-done');
      yield* h.ledger.acknowledge([ending], 'run-done');
      yield* h.complete(completed('run-done', h.source.id), { handled: [ending], answer: 'DONE: the tests passed.' });
      yield* h.complete(completed('run-asked', h.source.id), { handled: [task], answer: 'The tests run in the background.' });
      const answers = h.reports().filter((report) => report.threadId === h.parent.id);
      expect(answers.map((report) => report.id)).toEqual([threadReportEnvelopeId(task, 'run-asked')]);
      expect(answers[0]?.body.text).toContain('DONE: the tests passed.');
    }),
  );
  it.effect(
    'a run that read a delegated report answers before the taking run reports, and the taking run then sends nothing',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const task = 'envelope:spawn:call-1';
      const review = spawnRequestId(h.source.id, 'call-review');
      yield* h.task(task, h.source.id, h.parent.id, 'run-asked');
      yield* h.ledger.acknowledge([task], 'run-asked');
      yield* h.pend('run-asked', h.source.id);
      yield* h.task(review, h.peer.id, h.source.id, 'run-review');
      yield* h.ledger.acknowledge([review], 'run-review');
      yield* h.report(threadReportEnvelopeId(review, 'run-review'), h.source.id, h.peer.id, 'run-done');
      yield* h.complete(completed('run-done', h.source.id), { answer: 'DONE: reviewed.' });
      yield* h.complete(completed('run-asked', h.source.id), { handled: [task], answer: 'Waiting for the review.' });
      const answers = h.reports().filter((report) => report.threadId === h.parent.id);
      expect(answers.map((report) => report.id)).toEqual([threadReportEnvelopeId(task, 'run-asked')]);
      expect(answers[0]?.body.text).toContain('DONE: reviewed.');
    }),
  );
  it.effect(
    'reporting records its obligation and the delivery outcome for the run',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn:call-1', h.source.id, h.parent.id, 'run-handled');
      yield* h.complete(completed('run-handled', h.source.id));
      expect(h.recording.runNotes('run-handled')).toEqual([
        { type: 'run-reporting', requests: 1, fallbacks: 1, diagnoses: 0, held: 0, closed: 0 },
      ]);
      const [report] = h.recording.activities();
      expect(report?.opened).toMatchObject({
        kind: 'report',
        thread: h.source.id,
        run: 'run-handled',
        parent: { run: 'run-handled' },
        attrs: { envelope: 'envelope:report:envelope:spawn:call-1:run-handled', request: 'envelope:spawn:call-1', target: h.parent.id },
      });
      expect(report?.ended).toMatchObject({ outcome: 'ok', result: { status: 'woken', targetRun: `woken:${h.parent.id}`, acted: true } });
    }),
  );
  it.effect(
    'an ending whose requests moved to a successor owes no report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn:call-1', h.source.id, h.parent.id, 'run-cut');
      yield* h.carry('run-cut', 'run-successor');
      yield* h.complete(completed('run-cut', h.source.id));
      expect(h.sent).toEqual([]);
      expect(h.recording.runNotes('run-cut')).toEqual([
        { type: 'run-reporting', requests: 0, fallbacks: 0, diagnoses: 0, held: 0, closed: 0 },
      ]);
      expect(h.recording.activities()).toEqual([]);
    }),
  );
  it.effect(
    'a queued task reports only after its follow-up run binds it',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.acceptedTask('envelope:queued', h.source.id, h.peer.id);
      yield* h.complete(completed('run-before-task', h.source.id));
      expect(h.sent).toEqual([]);
      yield* h.bind(['envelope:queued'], 'run-followup');
      yield* h.complete(completed('run-followup', h.source.id));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.recipient.id).toBe(h.peer.id);
      expect(h.row('envelope:queued')).toMatchObject({ state: 'acknowledged', deliveredToRunId: 'run-followup' });
    }),
  );
  it.effect(
    'withdrawing a queued request closes it and answers its sender exactly once',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.acceptedTask('envelope:queued', h.source.id, h.peer.id);
      expect(yield* h.withdraw(h.source, 'envelope:queued')).toBe(true);
      expect(h.row('envelope:queued')).toMatchObject({ state: 'acknowledged' });
      expect(h.row('envelope:withdrawn:envelope:queued')).toMatchObject({
        threadId: h.peer.id,
        kind: 'envelope',
        body: { intent: 'report', inReplyTo: 'envelope:queued' },
      });
      expect(h.published).toContain(h.source.id);
      expect(h.closure('envelope:queued')).toBe('envelope:withdrawn:envelope:queued');
      expect(yield* h.withdraw(h.source, 'envelope:queued')).toBe(false);
      expect(h.reports()).toHaveLength(1);
    }),
  );
  it.effect(
    'concurrent delivery of one envelope leaves one item and answers both callers',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness({ pairDelivery: true });
      h.working.add(h.peer.id);
      const report = { id: 'envelope:report:raced', intent: 'report' as const, text: 'The work is complete.' };
      const receipts = yield* Effect.all([h.deliver(h.peer, report), h.deliver(h.peer, report)], { concurrency: 2 });
      expect(receipts.map((receipt) => receipt.envelopeId)).toEqual([report.id, report.id]);
      expect(receipts.every((receipt) => receipt.status === 'delivered')).toBe(true);
      expect(h.reports()).toHaveLength(1);
      expect(h.sent).toHaveLength(1);
    }),
  );
  it.effect(
    'a taken request and an unknown request are not withdrawn',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:taken', h.source.id, h.peer.id, 'run-holding');
      expect(yield* h.withdraw(h.source, 'envelope:taken')).toBe(false);
      expect(yield* h.withdraw(h.source, 'envelope:nobody')).toBe(false);
      expect(h.row('envelope:taken')).toMatchObject({ state: 'delivered' });
      expect(h.reports()).toEqual([]);
    }),
  );
  it.effect(
    'a run taking the request during withdrawal keeps it',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.acceptedTask('envelope:queued', h.source.id, h.peer.id);
      h.beforeUnit(Effect.orDie(h.bind(['envelope:queued'], 'run-took-it')));
      expect(yield* h.withdraw(h.source, 'envelope:queued')).toBe(false);
      expect(h.row('envelope:queued')).toMatchObject({ state: 'delivered', deliveredToRunId: 'run-took-it' });
      expect(h.reports()).toEqual([]);
    }),
  );
  it.effect(
    'a failed withdrawal delivery leaves the sender a durable report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.acceptedTask('envelope:queued', h.source.id, h.peer.id);
      h.failNextSend(new Error('delivery cut'));
      expect(Exit.isFailure(yield* Effect.exit(h.withdraw(h.source, 'envelope:queued')))).toBe(true);
      expect(h.row('envelope:queued')).toMatchObject({ state: 'acknowledged' });
      expect(h.row('envelope:withdrawn:envelope:queued')).toMatchObject({
        threadId: h.peer.id,
        state: 'queued',
        body: { intent: 'report', inReplyTo: 'envelope:queued' },
      });
    }),
  );
  it.effect(
    'a direct operator run in a child emits no agent report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.complete(completed('run-operator', h.source.id));
      expect(h.source.parentThreadId).toBe(h.parent.id);
      expect(h.sent).toEqual([]);
      expect(h.reports()).toEqual([]);
    }),
  );
  it.effect(
    'settlement replay reuses the standing report receipt',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:task', h.source.id, h.peer.id, 'run-replayed');
      const event = completed('run-replayed', h.source.id);
      yield* h.complete(event);
      yield* h.complete(event);
      expect(h.sent).toHaveLength(1);
      expect(h.reports()).toHaveLength(1);
    }),
  );
  it.effect(
    'an uncertain CLI receipt survives retry without applying the envelope again',
    Effect.fnUntraced(function* () {
      const acceptance = { status: 'unconfirmed' as const, reason: 'The CLI has not confirmed receipt.' };
      const h = yield* envelopeHarness({ acceptance });
      h.working.add(h.peer.id);
      const envelope = { id: 'envelope:uncertain', intent: 'message' as const, text: 'execute once' };
      const first = yield* h.deliver(h.peer, envelope);
      yield* h.bind([envelope.id], first.runId!);
      const replay = yield* h.deliver(h.peer, envelope);
      expect(first.acceptance).toEqual(acceptance);
      expect(replay).toMatchObject({ status: first.status, runId: first.runId, acceptance, acted: false });
      expect(h.sent.map((entry) => entry.signal.text)).toEqual([envelope.text]);
    }),
  );
  it.effect(
    'retry finishes an unread envelope and preserves a waiting task request',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.working.add(h.peer.id);
      const report = { id: 'envelope:report:once', intent: 'report' as const, text: 'The work is complete.' };
      h.failNextSend(new Error('delivery cut'));
      expect(Exit.isFailure(yield* Effect.exit(h.deliver(h.peer, report)))).toBe(true);
      expect(h.row(report.id)).toMatchObject({ state: 'queued' });
      expect(h.sent).toEqual([]);
      expect(yield* h.deliver(h.peer, report)).toMatchObject({ acted: true, status: 'delivered', runId: `active:${h.peer.id}` });
      expect(h.reports()).toHaveLength(1);
      const task = { id: 'envelope:task:once', intent: 'task' as const, text: 'Take this up.' };
      yield* h.deliver(h.peer, task);
      expect(yield* h.deliver(h.peer, task)).toMatchObject({ acted: false, status: 'queued' });
    }),
  );
  it.effect(
    'one run answers its task once even when a repeated settlement changes its ending',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:task', h.source.id, h.peer.id, 'run-twice');
      yield* h.complete(completed('run-twice', h.source.id));
      yield* h.complete({
        runId: 'run-twice',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'agent',
      });
      expect(h.reports()).toHaveLength(1);
      expect(h.sent).toHaveLength(1);
    }),
  );
  it.effect(
    'an operator stop stays silent and leaves work owed to the continued run',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:stopped', h.source.id, h.parent.id, 'run-stopped');
      yield* h.complete({
        runId: 'run-stopped',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'reader',
      });
      expect(h.sent).toEqual([]);
      expect(h.reports()).toEqual([]);
      expect(h.row('envelope:stopped')).toMatchObject({ state: 'delivered' });
      yield* h.carry('run-stopped', 'run-continued');
      yield* h.complete(completed('run-continued', h.source.id));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.recipient.id).toBe(h.parent.id);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:stopped']);
    }),
  );
  it.effect(
    'a parent stop leaves its request owed while reporting a peer task',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-stopped');
      yield* h.task('envelope:peer', h.source.id, h.peer.id, 'run-stopped');
      yield* h.complete({
        runId: 'run-stopped',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'parent',
      });
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.peer.id]);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:peer']);
      expect(h.row('envelope:spawn')).toMatchObject({ state: 'delivered' });
      yield* h.carry('run-stopped', 'run-continued');
      yield* h.complete(completed('run-continued', h.source.id));
      expect(h.sent.filter((delivery) => delivery.recipient.id === h.parent.id)).toHaveLength(1);
      expect(h.row('envelope:report:envelope:spawn:run-continued')).toMatchObject({
        threadId: h.parent.id,
        body: { intent: 'report', inReplyTo: 'envelope:spawn' },
      });
    }),
  );
  it.effect(
    'an unclaimed stop reports the recorded failure reason to its requester',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:torn', h.source.id, h.parent.id, 'run-torn');
      const failureReason = 'the provider closed the stream';
      yield* h.complete({ runId: 'run-torn', threadId: h.source.id, status: 'aborted', failureReason, failure: null, stoppedBy: null });
      expect(h.sent[0]?.signal.text).toContain(failureReason);
      expect(h.row('envelope:report:envelope:torn:run-torn')).toMatchObject({
        threadId: h.parent.id,
        body: { intent: 'report', inReplyTo: 'envelope:torn' },
      });
    }),
  );
  it.effect(
    'a failed run reports its diagnostic data and full-record identifiers',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:failed-task', h.source.id, h.peer.id, 'run-failed');
      yield* h.complete({
        runId: 'run-failed',
        threadId: h.source.id,
        status: 'failed',
        failureReason: 'input_schema does not support anyOf at the top level',
        failure: {
          provider: 'subscription',
          account: null,
          stage: 'RequestExecutor.execute',
          type: 'InvalidRequest',
          httpStatus: 400,
          retryable: false,
          modelStarted: false,
          detail: 'request req-safe was refused',
          record: { threadId: h.source.id, runId: 'run-failed', entryId: 'transcript:error:run-failed' },
        },
        stoppedBy: null,
      });
      const report = h.sent[0]?.signal.text;
      for (const datum of [
        'subscription',
        'RequestExecutor.execute',
        'InvalidRequest',
        '400',
        h.source.id,
        'run-failed',
        'transcript:error:run-failed',
      ])
        expect(report).toContain(datum);
    }),
  );
});
describe('ThreadEnvelopes delivery', () => {
  it.effect(
    'a task for a plain child keeps the parent voice without losing its task intent',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.rename({ ...h.source, plain: true }, h.source.name!);
      yield* h.send(h.parent, { to: h.source.id, intent: 'task', text: 'Continue the work.', key: 'plain-task' });
      expect(h.row(threadEnvelopeId('task', h.parent.id, 'plain-task', 0))).toMatchObject({
        kind: 'task',
        sender: { kind: 'thread', threadId: h.parent.id, asOperator: true },
        body: { intent: 'task', text: 'Continue the work.' },
      });
    }),
  );
  it.effect(
    'a message wakes an idle recipient and joins an active one',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const idle = yield* h.send(h.parent, { to: h.peer.id, intent: 'message', text: 'the handoff is ready' });
      h.working.add(h.peer.id);
      const busy = yield* h.send(h.parent, { to: h.peer.id, intent: 'message', text: 'one more thing' });
      expect(yield* only(idle)).toMatchObject({ intent: 'message', status: 'woken', acted: true });
      expect(yield* only(busy)).toMatchObject({ intent: 'message', status: 'delivered', acted: true });
    }),
  );
  it.effect(
    'a remote active receipt retains the run that will consume it',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness({ remoteActive: true });
      h.working.add(h.peer.id);
      expect(
        yield* only(yield* h.send(h.parent, { to: h.peer.id, intent: 'message', text: 'Read this at the next boundary.' })),
      ).toMatchObject({ status: 'queued', runId: `active:${h.peer.id}`, intent: 'message' });
    }),
  );
  it.effect(
    'an unknown address answers without advancing a long deadline',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      expect(yield* h.wait(h.source, ['nobody'], 3_600_000)).toEqual({
        unknown: ['nobody'],
        arrived: [],
        silent: [],
        others: [],
        ended: [],
        expired: false,
      });
    }),
  );
  it.effect(
    'a report accepted before the wait releases its unread barrier even before since',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.working.add(h.parent.id);
      h.setDirectory(h.source.id, { assignment: 'running', life: 'working' });
      yield* h.deliver(h.parent, { id: 'earlier-report', intent: 'report', text: 'Already accepted.' });
      const accepted = yield* h.ledger.receipt('earlier-report');
      const waited = yield* h.wait(h.parent, [h.source.name!], 50, new Date(Date.parse(accepted!.occurredAt) + 1));
      expect(waited.arrived).toMatchObject([{ envelopeId: 'earlier-report', intent: 'report' }]);
      expect(waited.expired).toBe(false);
    }),
  );
  it.effect(
    'publication after the last inbox snapshot is not lost before parking',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.source.id, { assignment: 'running', life: 'working' });
      h.afterRead(
        Effect.orDie(
          Effect.andThen(
            Effect.sync(() => h.setDirectory(h.source.id, { assignment: 'completed', life: 'idle' })),
            h.complete(completed('ended-at-read', h.source.id)),
          ),
        ),
      );
      const answer = yield* h.wait(h.parent, [h.source.id], 1000);
      expect(answer.ended).toEqual([{ address: h.source.id, ending: 'completed' }]);
      expect(answer.expired).toBe(false);
    }),
  );
  it.effect(
    'reconciliation observes a durable ending with no local publication',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness({ reconcileIntervalMs: 5 });
      h.setDirectory(h.source.id, { assignment: 'running', life: 'working' });
      h.afterDirectoryRead(() => h.setDirectory(h.source.id, { assignment: 'completed', life: 'idle' }));
      const waiting = yield* Effect.forkScoped(h.wait(h.parent, [h.source.id], 1000));
      yield* h.waitRead;
      yield* TestClock.adjust(5);
      expect((yield* Fiber.join(waiting)).ended).toEqual([{ address: h.source.id, ending: 'completed' }]);
    }),
  );
  it.effect(
    'an ended target returns its ending without clock movement',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'idle', assignment: 'completed' });
      const outcome = yield* h.wait(h.source, [h.peer.name!], 3_600_000);
      expect(outcome).toEqual({
        ended: [{ address: h.peer.name!, ending: 'completed' }],
        arrived: [],
        others: [],
        silent: [],
        unknown: [],
        expired: false,
      });
    }),
  );
  it.effect(
    'an archived target is ended after leaving the live directory',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, null);
      const outcome = yield* h.wait(h.source, [h.peer.name!], 3_600_000);
      expect(outcome.ended).toEqual([{ address: h.peer.name!, ending: 'archived' }]);
      expect(outcome.expired).toBe(false);
    }),
  );
  it.effect(
    'a mixed wait parks only for its working target',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'idle', assignment: 'failed' });
      h.setDirectory(h.parent.id, { life: 'working', assignment: 'running' });
      const waiting = yield* Effect.forkScoped(h.wait(h.source, [h.peer.name!, h.parent.name!], 1000));
      yield* h.waitRead;
      yield* h.send(h.parent, { to: h.source.id, intent: 'message', text: 'the live target arrived' });
      const result = yield* Fiber.join(waiting);
      expect(result.ended).toEqual([{ address: h.peer.name!, ending: 'failed' }]);
      expect(result.arrived).toMatchObject([{ from: h.parent.name, text: 'the live target arrived' }]);
      expect(result.silent).toEqual([]);
    }),
  );
  it.effect(
    'a working target wakes its parked reader with an arrival',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'working', assignment: 'running' });
      const waiting = yield* Effect.forkScoped(h.wait(h.source, [h.peer.name!], 1000));
      yield* h.waitRead;
      yield* h.send(h.peer, { to: h.source.id, intent: 'message', text: 'the named agent arrived' });
      const result = yield* Fiber.join(waiting);
      expect(result.arrived).toMatchObject([{ from: h.peer.name, intent: 'message', text: 'the named agent arrived' }]);
      expect(result.others).toEqual([]);
      expect(result.silent).toEqual([]);
      expect(result.expired).toBe(false);
    }),
  );
  it.effect(
    'a working target ending without delivery wakes its parked reader',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'working', assignment: 'running' });
      const waiting = yield* Effect.forkScoped(h.wait(h.source, [h.peer.name!], 3_600_000));
      yield* h.waitRead;
      h.setDirectory(h.peer.id, { life: 'idle', assignment: 'completed' });
      yield* h.complete(completed('run-nobody-asked-for', h.peer.id));
      const result = yield* Fiber.join(waiting);
      expect(result.ended).toEqual([{ address: h.peer.name!, ending: 'completed' }]);
      expect(result.arrived).toEqual([]);
      expect(result.silent).toEqual([]);
      expect(result.expired).toBe(false);
    }),
  );
  it.effect(
    'a target reporting and ending in one settlement is read as arrived',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('task-1', h.peer.id, h.source.id, 'run-1');
      h.setDirectory(h.peer.id, { life: 'working', assignment: 'running' });
      const waiting = yield* Effect.forkScoped(h.wait(h.source, [h.peer.name!], 3_600_000));
      yield* h.waitRead;
      h.setDirectory(h.peer.id, { life: 'idle', assignment: 'completed' });
      yield* h.complete(completed('run-1', h.peer.id));
      const result = yield* Fiber.join(waiting);
      expect(result.arrived).toMatchObject([{ from: h.peer.name, intent: 'report' }]);
      expect(result.ended).toEqual([]);
      expect(result.silent).toEqual([]);
      expect(result.expired).toBe(false);
    }),
  );
  it.effect(
    'an outside arrival releases the wait and leaves its named target silent',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'working', assignment: 'running' });
      const waiting = yield* Effect.forkScoped(h.wait(h.source, [h.peer.name!], 1000));
      yield* h.waitRead;
      yield* h.send(h.parent, { to: h.source.id, intent: 'message', text: 'the parent changed the plan' });
      const result = yield* Fiber.join(waiting);
      expect(result.arrived).toEqual([]);
      expect(result.others).toMatchObject([{ from: h.parent.name, intent: 'message', text: 'the parent changed the plan' }]);
      expect(result.silent).toEqual([h.peer.name!]);
      expect(result.expired).toBe(false);
    }),
  );
  it.effect(
    'an empty wait returns without expiring',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      expect(yield* h.wait(h.source, [], 3_600_000)).toEqual({
        arrived: [],
        others: [],
        silent: [],
        ended: [],
        unknown: [],
        expired: false,
      });
    }),
  );
  it.effect(
    'a repeated key replays its envelope and refuses another recipient or text',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const send = (to: string, text: string) => h.send(h.source, { to, intent: 'message', text, key: 'one-call' });
      const envelopeId = `envelope:message:${h.source.id}:one-call:0`;
      expect(yield* only(yield* send('parent', 'Read this.'))).toMatchObject({ envelopeId, acted: true });
      expect(yield* only(yield* send('parent', 'Read this.'))).toMatchObject({ envelopeId });
      expect(yield* rejection(send('parent', 'Other words.'))).toBe('key-reused');
      expect(yield* rejection(send(h.peer.id, 'Read this.'))).toBe('key-reused');
      expect(h.row(envelopeId)).toMatchObject({ threadId: h.parent.id, body: { text: 'Read this.' } });
    }),
  );
  it.effect(
    'an unknown name returns this team address space without sending',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      expect(yield* h.send(h.source, { to: 'reviewer', intent: 'task', text: 'read the diff' })).toEqual({
        status: 'not-found',
        addresses: ['reviewer'],
        addressable: ['parent'],
      });
      expect(h.sent).toEqual([]);
    }),
  );
  it.effect(
    'a team name resolves to its recipient',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      expect(yield* only(yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'reading your files now' }))).toMatchObject({
        status: 'woken',
        acted: true,
      });
      expect(h.sent[0]?.recipient.id).toBe(h.parent.id);
    }),
  );
});
describe('ThreadEnvelopes sends to several agents', () => {
  const words = 'The schema changed: read it again.';
  const envelopeOf = (sender: ThreadRecord, key: string, position: number, intent = 'message') =>
    `envelope:${intent}:${sender.id}:${key}:${position}`;
  it.effect(
    'one send retains recipient order and gives each one its own envelope and the same text',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      h.working.add(h.peer.id);
      const answer = yield* h.send(h.source, { to: ['parent', kid!.name!, h.peer.id], intent: 'message', text: words, key: 'broadcast' });
      expect(answer).toMatchObject({
        status: 'sent',
        deliveries: [
          { envelopeId: envelopeOf(h.source, 'broadcast', 0), status: 'woken', recipient: { threadId: h.parent.id, sameTeam: true } },
          { envelopeId: envelopeOf(h.source, 'broadcast', 1), status: 'woken', recipient: { threadId: kid!.id, sameTeam: true } },
          { envelopeId: envelopeOf(h.source, 'broadcast', 2), status: 'delivered', recipient: { threadId: h.peer.id, sameTeam: false } },
        ],
      });
      for (const [position, recipient] of [h.parent, kid!, h.peer].entries())
        expect(h.row(envelopeOf(h.source, 'broadcast', position))).toMatchObject({
          threadId: recipient.id,
          sender: { kind: 'thread', threadId: h.source.id },
          kind: 'envelope',
          body: { intent: 'message', text: words, inReplyTo: null },
        });
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.parent.id, kid!.id, h.peer.id]);
    }),
  );
  it.effect(
    'words from a thread living in another project carry its home to the recipient',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.rename({ ...h.source, projectId: 39 }, h.source.name!);
      yield* h.send(h.source, { to: ['parent'], intent: 'message', text: words, key: 'home' });
      const item = h.row(envelopeOf(h.source, 'home', 0))!;
      expect(item).toMatchObject({ sender: { kind: 'thread', threadId: h.source.id, projectId: 39 } });
      expect(carriesWords(item) ? threadSignalOfInboxItem(item) : null).toMatchObject({ senderThreadId: h.source.id, senderProjectId: 39 });
    }),
  );
  it.effect(
    'an unknown recipient sends nothing and the corrected list may reuse its key',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      const stored = h.count();
      const send = (to: readonly string[]) => h.send(h.source, { to, intent: 'message', text: words, key: 'corrected' });
      expect(yield* send(['parent', 'reviewer', kid!.name!])).toMatchObject({ status: 'not-found', addresses: ['reviewer'] });
      expect(h.count()).toBe(stored);
      expect(h.sent).toEqual([]);
      expect(yield* send(['parent', kid!.name!])).toMatchObject({ status: 'sent', deliveries: [{ acted: true }, { acted: true }] });
      expect(h.count()).toBe(stored + 2);
    }),
  );
  it.effect(
    'a name and id identifying one recipient produce one envelope',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const stored = h.count();
      const answer = yield* h.send(h.source, { to: ['parent', h.parent.id], intent: 'message', text: words });
      expect(yield* only(answer)).toMatchObject({ recipient: { threadId: h.parent.id } });
      expect(h.count()).toBe(stored + 1);
      expect(h.sent).toHaveLength(1);
    }),
  );
  it.effect(
    'replay preserves accepted envelopes and a changed recipient list refuses',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      const send = (to: readonly string[]) => h.send(h.source, { to, intent: 'message', text: words, key: 'once' });
      const ids = [envelopeOf(h.source, 'once', 0), envelopeOf(h.source, 'once', 1)];
      yield* send(['parent', kid!.name!]);
      yield* h.bind(ids, 'run-reading');
      const stored = h.count();
      expect(yield* send(['parent', kid!.name!])).toMatchObject({
        status: 'sent',
        deliveries: [
          { envelopeId: ids[0], acted: false },
          { envelopeId: ids[1], acted: false },
        ],
      });
      expect(h.count()).toBe(stored);
      expect(yield* rejection(send([kid!.name!, 'parent']))).toBe('key-reused');
      expect(yield* rejection(send(['parent']))).toBe('key-reused');
    }),
  );
  it.effect(
    'a recorded send replays its recipient home even after the name is gone',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const kid = { ...h.crowd(1)[0]!, projectId: 7 };
      const send = () => h.send(h.source, { to: ['parent', 'helper'], intent: 'message', text: words, key: 'recorded' });
      h.rename(kid, 'helper');
      expect(yield* send()).toMatchObject({
        status: 'sent',
        deliveries: [{ recipient: { threadId: h.parent.id } }, { recipient: { threadId: kid.id, projectId: 7 } }],
      });
      h.rename(kid, 'renamed');
      const stored = h.count();
      expect(yield* send()).toMatchObject({
        status: 'sent',
        deliveries: [
          { envelopeId: envelopeOf(h.source, 'recorded', 0), recipient: { threadId: h.parent.id } },
          { envelopeId: envelopeOf(h.source, 'recorded', 1), recipient: { threadId: kid.id, projectId: 7 } },
        ],
      });
      expect(h.count()).toBe(stored);
      expect(yield* h.settle(h.source, { to: ['parent', 'helper'], intent: 'message', text: words, key: 'recorded' })).toMatchObject({
        status: 'completed',
        output: {
          status: 'sent',
          deliveries: [{ recipient: { threadId: h.parent.id } }, { recipient: { threadId: kid.id, projectId: 7 } }],
        },
      });
    }),
  );
  it.effect(
    'one failed recipient retains a pending wake while another receives its envelope',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      h.unreachable.add(h.parent.id);
      const answer = yield* h.send(h.source, { to: ['parent', kid!.name!], intent: 'message', text: words, key: 'partial' });
      expect(answer).toMatchObject({
        status: 'sent',
        deliveries: [
          { recipient: { threadId: h.parent.id }, status: 'pending', acted: false, failure: expect.any(String) },
          { recipient: { threadId: kid!.id }, status: 'woken', acted: true },
        ],
      });
      expect((yield* h.ledger.pendingWakes(1)).map((item) => item.id)).toEqual([envelopeOf(h.source, 'partial', 0)]);
    }),
  );
  it.effect(
    'a final deduplicates its requester address and settles as the recorded answer',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const ask = { to: ['parent', h.parent.id, 'parent'], intent: 'message' as const, text: 'Done.', final: true, key: 'final-once' };
      expect(yield* only(yield* h.send(h.source, ask))).toMatchObject({ recipient: { threadId: h.parent.id }, closed: ['envelope:spawn'] });
      expect(yield* h.settle(h.source, ask)).toMatchObject({ status: 'completed' });
    }),
  );
  it.effect(
    'a final to two recipients refuses without closing its request or writing an answer',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const stored = h.count();
      expect(yield* h.send(h.source, { to: ['parent', h.peer.id], intent: 'message', text: 'Done.', final: true })).toEqual({
        status: 'refused',
        code: 'final-to-many',
      });
      expect(h.closure('envelope:spawn')).toBeUndefined();
      expect(h.count()).toBe(stored);
    }),
  );
  it.effect(
    'a task sent to two children opens independent requests and final closes only its own',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [first, second] = h.crowd(2);
      const toFirst = envelopeOf(h.parent, 'fan', 0, 'task');
      const toSecond = envelopeOf(h.parent, 'fan', 1, 'task');
      yield* h.send(h.parent, { to: [first!.name!, second!.name!], intent: 'task', text: words, key: 'fan' });
      expect((yield* h.ledger.openRequests(first!.id)).map((request) => request.id)).toEqual([toFirst]);
      expect((yield* h.ledger.openRequests(second!.id)).map((request) => request.id)).toEqual([toSecond]);
      yield* h.bind([toFirst], 'run-first');
      yield* h.bind([toSecond], 'run-second');
      expect(yield* only(yield* h.send(first!, { to: 'parent', intent: 'message', text: 'Read it.', final: true }))).toMatchObject({
        closed: [toFirst],
      });
      expect(h.closure(toFirst)).toBe(`envelope:final:${toFirst}`);
      expect(h.closure(toSecond)).toBeUndefined();
    }),
  );
  it.effect(
    'a delivery defect retains each accepted wake without adding wakes for successful delivery',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      const cut = [envelopeOf(h.source, 'cut', 0), envelopeOf(h.source, 'cut', 1)];
      h.failNextSend(new Error('delivery cut'));
      expect(
        Exit.isFailure(yield* Effect.exit(h.send(h.source, { to: ['parent', kid!.name!], intent: 'message', text: words, key: 'cut' }))),
      ).toBe(true);
      expect((yield* h.ledger.pendingWakes(2)).map((item) => item.id)).toEqual(cut);
      yield* h.send(h.source, { to: ['parent', kid!.name!], intent: 'message', text: words, key: 'whole' });
      expect((yield* h.ledger.pendingWakes(2)).map((item) => item.id)).toEqual(cut);
    }),
  );
  it.effect(
    'settlement finds a task behind its compaction barrier in the recorded home',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const recipient = { ...h.crowd(1)[0]!, projectId: 7 };
      h.rename(recipient, 'helper');
      const ask = { to: ['helper'], intent: 'task' as const, text: words, key: 'compact-cut' };
      expect(yield* h.settle(h.source, ask, true)).toEqual({ status: 'aborted' });
      const id = `envelope:task:${h.source.id}:compact-cut:0`;
      const accepted = behindBarrier(
        inboxCompactionValues(recipient.id, { at: 'end' }, `compaction:${id}`),
        taskItem(id, recipient.id, h.source.id),
      );
      yield* h.ledger.put(accepted);
      h.rename(recipient, 'renamed');
      expect(yield* h.settle(h.source, ask, true)).toMatchObject({
        status: 'completed',
        output: {
          status: 'sent',
          deliveries: [{ envelopeId: accepted.id, acted: false, recipient: { threadId: recipient.id, projectId: 7 } }],
        },
      });
      expect(h.row(accepted.id)?.state).toBe('queued');
    }),
  );
  it.effect(
    'settlement finishes an accepted cut send and identifies a send never accepted',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      const [kid] = h.crowd(1);
      const ask = { to: ['parent', kid!.name!], intent: 'message' as const, text: words, key: 'settled' };
      expect(yield* h.settle(h.source, ask)).toEqual({ status: 'aborted' });
      h.failNextSend(new Error('delivery cut'));
      expect(Exit.isFailure(yield* Effect.exit(h.send(h.source, ask)))).toBe(true);
      expect(yield* h.settle(h.source, ask)).toMatchObject({
        status: 'completed',
        output: {
          status: 'sent',
          deliveries: [{ envelopeId: envelopeOf(h.source, 'settled', 0) }, { envelopeId: envelopeOf(h.source, 'settled', 1) }],
        },
      });
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.parent.id, kid!.id]);
      expect(yield* h.ledger.pendingWakes(1)).toEqual([]);
    }),
  );
});
describe('ThreadEnvelopes successor runs', () => {
  it.effect(
    'a torn run and its successor answer their carried task without answering the interrupt',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-torn');
      yield* h.request('envelope:reason', h.source.id, h.parent.id, 'run-torn', 'interrupt');
      yield* h.complete({
        runId: 'run-torn',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: 'the orchestrator interrupted it',
        failure: null,
        stoppedBy: 'agent',
      });
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.recipient.id).toBe(h.parent.id);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:spawn']);
      yield* h.carry('run-torn', 'run-successor');
      yield* h.complete(completed('run-successor', h.source.id));
      expect(h.sent).toHaveLength(2);
      expect(h.sent[1]?.recipient.id).toBe(h.parent.id);
      expect(h.row('envelope:report:envelope:spawn:run-successor')).toMatchObject({
        threadId: h.parent.id,
        kind: 'envelope',
        body: { intent: 'report', inReplyTo: 'envelope:spawn' },
      });
    }),
  );
  it.effect(
    'a requester interrupt suppresses its torn-run report but its successor answers',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-torn');
      yield* h.request('envelope:reason', h.source.id, h.parent.id, null, 'interrupt');
      yield* h.complete({
        runId: 'run-torn',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'agent',
      });
      expect(h.sent).toEqual([]);
      expect(h.reports()).toEqual([]);
      yield* h.carry('run-torn', 'run-successor');
      yield* h.bind(['envelope:reason'], 'run-successor');
      yield* h.complete(completed('run-successor', h.source.id));
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.recipient.id).toBe(h.parent.id);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:spawn']);
    }),
  );
  it.effect(
    'a peer task requester still hears the interrupted ending',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-torn');
      yield* h.task('envelope:peer', h.source.id, h.peer.id, 'run-torn');
      yield* h.request('envelope:reason', h.source.id, h.parent.id, null, 'interrupt');
      yield* h.complete({
        runId: 'run-torn',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'agent',
      });
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.peer.id]);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:peer']);
    }),
  );
  it.effect(
    'an interrupter that gave no task is owed no successor report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-torn');
      yield* h.request('envelope:reason', h.source.id, h.peer.id, 'run-torn', 'interrupt');
      yield* h.carry('run-torn', 'run-successor');
      yield* h.complete(completed('run-successor', h.source.id));
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.parent.id]);
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:spawn']);
    }),
  );
  it.effect(
    'a cut run and its continuation each answer the carried task',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-cut');
      yield* h.complete({ runId: 'run-cut', threadId: h.source.id, status: 'cut', failureReason: null, failure: null, stoppedBy: null });
      expect(h.sent).toHaveLength(1);
      yield* h.carry('run-cut', 'run-continued');
      yield* h.complete(completed('run-continued', h.source.id));
      expect(h.sent).toHaveLength(2);
      expect(h.sent[1]?.recipient.id).toBe(h.parent.id);
      expect(
        h
          .reports()
          .map((report) => report.id)
          .sort(),
      ).toEqual(['envelope:report:envelope:spawn:run-continued', 'envelope:report:envelope:spawn:run-cut']);
    }),
  );
  it.effect(
    'a completed run keeps its acknowledged request instead of carrying it',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-done');
      yield* h.complete(completed('run-done', h.source.id));
      expect(h.sent).toHaveLength(1);
      expect(h.row('envelope:spawn')).toMatchObject({ state: 'acknowledged', deliveredToRunId: 'run-done' });
    }),
  );
});
describe('ThreadEnvelopes final answers', () => {
  it.effect(
    'one final closes every taken request of its requester against the newest request',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      yield* h.ledger.acknowledge(['envelope:spawn'], 'run-1');
      yield* h.request('envelope:more', h.source.id, h.parent.id, 'run-2', 'task');
      yield* h.ledger.acknowledge(['envelope:more'], 'run-2');
      yield* h.acceptedTask('envelope:later', h.source.id, h.parent.id);
      const receipt = yield* h.send(
        h.source,
        { to: 'parent', intent: 'message', text: 'Both parts are built and landed.', final: true },
        'run-9',
      );
      expect(yield* only(receipt)).toMatchObject({
        envelopeId: 'envelope:final:envelope:more',
        intent: 'report',
        status: 'woken',
        acted: true,
        closed: ['envelope:spawn', 'envelope:more'],
      });
      expect(h.sent.map((delivery) => delivery.recipient.id)).toEqual([h.parent.id]);
      expect(h.row('envelope:final:envelope:more')).toMatchObject({
        threadId: h.parent.id,
        kind: 'envelope',
        body: { intent: 'report', inReplyTo: 'envelope:more', text: 'Both parts are built and landed.' },
      });
      expect(h.closure('envelope:spawn')).toBe('envelope:final:envelope:more');
      expect(h.closure('envelope:more')).toBe('envelope:final:envelope:more');
      expect(h.closure('envelope:later')).toBeUndefined();
      expect(h.recording.runNotes('run-9')).toEqual([
        { type: 'request-closed', request: 'envelope:spawn', by: 'envelope:final:envelope:more' },
        { type: 'request-closed', request: 'envelope:more', by: 'envelope:final:envelope:more' },
      ]);
    }),
  );
  it.effect(
    'a repeated final, a final owed nothing and a final naming an envelope refuse',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const final = (to: string, inReplyTo?: string) => h.send(h.source, { to, intent: 'message', text: 'Done.', final: true, inReplyTo });
      expect(yield* final('parent', 'envelope:spawn')).toEqual({ status: 'refused', code: 'final-in-reply' });
      expect(h.closure('envelope:spawn')).toBeUndefined();
      expect(yield* only(yield* final('parent'))).toMatchObject({ status: 'woken', closed: ['envelope:spawn'] });
      yield* h.bind(['envelope:final:envelope:spawn'], `woken:${h.parent.id}`);
      expect(yield* final('parent')).toEqual({ status: 'refused', code: 'no-open-request' });
      expect(yield* final(h.peer.id)).toEqual({ status: 'refused', code: 'no-open-request' });
      expect(h.reports()).toHaveLength(1);
    }),
  );
  it.effect(
    'retry completes a final whose wake died after closure without duplicating it',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const final = () => h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true });
      h.failNextSend(new Error('delivery cut'));
      expect(Exit.isFailure(yield* Effect.exit(final()))).toBe(true);
      expect(h.closure('envelope:spawn')).toBe('envelope:final:envelope:spawn');
      expect(h.row('envelope:final:envelope:spawn')).toMatchObject({ state: 'queued' });
      expect(h.sent).toEqual([]);
      expect(yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'Other words.', final: true })).toEqual({
        status: 'refused',
        code: 'no-open-request',
      });
      expect(yield* only(yield* final())).toMatchObject({
        envelopeId: 'envelope:final:envelope:spawn',
        status: 'woken',
        acted: true,
        closed: [],
      });
      expect(h.sent).toHaveLength(1);
      expect(h.reports()).toHaveLength(1);
    }),
  );
  it.effect(
    'settlement completes an accepted final and identifies a final never accepted',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const settle = () => h.settle(h.source, { to: ['parent'], intent: 'message', text: 'Done.', key: 'final-call', final: true });
      expect(yield* settle()).toEqual({ status: 'aborted' });
      h.failNextSend(new Error('delivery cut'));
      expect(Exit.isFailure(yield* Effect.exit(h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true })))).toBe(
        true,
      );
      expect(yield* settle()).toMatchObject({
        status: 'completed',
        output: { status: 'sent', deliveries: [{ envelopeId: 'envelope:final:envelope:spawn', status: 'woken', acted: true }] },
      });
      expect(h.sent).toHaveLength(1);
      expect(h.reports()).toHaveLength(1);
    }),
  );
  it.effect(
    'a final closing the request after the ending read it prevents another report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-opened');
      h.beforeUnit(Effect.asVoid(Effect.orDie(h.ledger.closeRequests(['envelope:spawn'], 'envelope:final:envelope:spawn'))));
      yield* h.complete(completed('run-opened', h.source.id));
      expect(h.reports()).toEqual([]);
      expect(h.sent).toEqual([]);
      expect(h.recording.activities()).toEqual([]);
    }),
  );
  it.effect(
    'keyed final replay keeps its first request and leaves a newer one owed',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      const final = (text: string) => h.send(h.source, { to: 'parent', intent: 'message', text, final: true, key: 'final-call' });
      expect(yield* only(yield* final('Done.'))).toMatchObject({ envelopeId: 'envelope:final:envelope:spawn', closed: ['envelope:spawn'] });
      yield* h.request('envelope:more', h.source.id, h.parent.id, 'run-2', 'task');
      expect(yield* only(yield* final('Done.'))).toMatchObject({ envelopeId: 'envelope:final:envelope:spawn', closed: ['envelope:spawn'] });
      expect(yield* rejection(final('Other words.'))).toBe('key-reused');
      expect(h.closure('envelope:more')).toBeUndefined();
      expect(h.reports().map((report) => report.id)).toEqual(['envelope:final:envelope:spawn']);
    }),
  );
  it.effect(
    'a key spent by an ordinary message refuses a final without closing work',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', key: 'one-call' });
      expect(yield* rejection(h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true, key: 'one-call' }))).toBe(
        'key-reused',
      );
      expect(h.closure('envelope:spawn')).toBeUndefined();
    }),
  );
  it.effect(
    'an empty inReplyTo still refuses beside final',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      expect(yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true, inReplyTo: '' })).toEqual({
        status: 'refused',
        code: 'final-in-reply',
      });
    }),
  );
  it.effect(
    'final to a deleted requester closes the orphaned obligation and refuses',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:orphan', h.source.id, 'deleted-thread', 'run-1');
      expect(yield* h.send(h.source, { to: 'deleted-thread', intent: 'message', text: 'Done.', final: true })).toEqual({
        status: 'refused',
        code: 'no-open-request',
      });
      expect(h.closure('envelope:orphan')).toBe('requester-gone');
      expect(h.sent).toEqual([]);
    }),
  );
  it.effect(
    'a final sent inside the opening run is its requester only report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-opened');
      yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true }, 'run-opened');
      yield* h.complete(completed('run-opened', h.source.id));
      expect(h.reports().map((report) => report.id)).toEqual(['envelope:final:envelope:spawn']);
      expect(h.sent).toHaveLength(1);
      expect(h.row('envelope:spawn')).toMatchObject({ state: 'acknowledged', deliveredToRunId: 'run-opened' });
      expect(h.recording.runNotes('run-opened')).toContainEqual({
        type: 'run-reporting',
        requests: 1,
        fallbacks: 0,
        diagnoses: 0,
        held: 0,
        closed: 1,
      });
    }),
  );
  it.effect(
    'a completed opening run leaves its request open and a later request gets its own fallback',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-opened');
      yield* h.complete(completed('run-opened', h.source.id));
      expect(h.closure('envelope:spawn')).toBeUndefined();
      yield* h.request('envelope:again', h.source.id, h.parent.id, 'run-again', 'task');
      yield* h.complete(completed('run-again', h.source.id));
      expect(h.reports().map((report) => report.body.inReplyTo)).toEqual(['envelope:spawn', 'envelope:again']);
    }),
  );
  it.effect(
    'a woken text run is silent while failure and cut diagnose every still-owed requester',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-opened');
      yield* h.complete(completed('run-opened', h.source.id));
      yield* h.task('envelope:review', h.source.id, h.peer.id, 'run-reviewed');
      yield* h.complete(completed('run-reviewed', h.source.id));
      const before = h.sent.length;
      yield* h.complete(completed('run-woken', h.source.id));
      expect(h.sent).toHaveLength(before);
      yield* h.complete({
        runId: 'run-stopped',
        threadId: h.source.id,
        status: 'aborted',
        failureReason: null,
        failure: null,
        stoppedBy: 'reader',
      });
      expect(h.sent).toHaveLength(before);
      yield* h.complete({
        runId: 'run-failed',
        threadId: h.source.id,
        status: 'failed',
        failureReason: 'the provider refused',
        failure: null,
        stoppedBy: null,
      });
      yield* h.complete({ runId: 'run-cut', threadId: h.source.id, status: 'cut', failureReason: null, failure: null, stoppedBy: null });
      expect(
        h
          .reports()
          .map((report) => report.id)
          .slice(2)
          .sort(),
      ).toEqual([
        'envelope:report:envelope:review:run-cut',
        'envelope:report:envelope:review:run-failed',
        'envelope:report:envelope:spawn:run-cut',
        'envelope:report:envelope:spawn:run-failed',
      ]);
      expect(h.recording.runNotes('run-cut').at(-1)).toMatchObject({ type: 'run-reporting', requests: 0, fallbacks: 0, diagnoses: 2 });
    }),
  );
  it.effect(
    'an ending closes a deleted requester without sending a report',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('envelope:orphan', h.source.id, 'deleted-thread', 'run-orphaned');
      yield* h.complete(completed('run-orphaned', h.source.id));
      expect(h.sent).toEqual([]);
      expect(h.closure('envelope:orphan')).toBe('requester-gone');
      expect(h.recording.runNotes('run-orphaned')).toContainEqual({
        type: 'request-closed',
        request: 'envelope:orphan',
        by: 'requester-gone',
      });
    }),
  );
  it.effect(
    'a wait passes over arrivals already read by its caller',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.peer.id, { life: 'working', assignment: 'running' });
      yield* h.send(h.peer, { to: h.source.id, intent: 'message', text: 'progress, not an answer' });
      const read = (yield* h.wait(h.source, [h.peer.name!], 1000)).arrived.map((arrival) => arrival.envelopeId);
      const waiting = yield* Effect.forkScoped(
        h.envelopes.access(h.source).waitFor({ from: [h.peer.name!], deadlineMs: 20, since: new Date(0), read: new Set(read) }),
      );
      yield* TestClock.adjust(20);
      const waited = yield* Fiber.join(waiting);
      expect(read).toHaveLength(1);
      expect(waited.arrived).toEqual([]);
      expect(waited.expired).toBe(true);
    }),
  );
});
describe('ThreadEnvelopes collecting', () => {
  it.effect('collection reads a final committed between its arrival snapshot and the closed request', () =>
    Effect.gen(function* () {
      const h = yield* envelopeHarness();
      yield* h.task('final-race', h.source.id, h.parent.id, 'member-run');
      h.setDirectory(h.source.id, { assignment: 'completed', life: 'idle' });
      h.afterRead(
        Effect.asVoid(Effect.orDie(h.send(h.source, { to: h.parent.id, intent: 'message', text: 'Collected answer', final: true }))),
      );
      const collected = yield* h.envelopes.access(h.parent).collect({ from: [h.source.id], deadlineMs: 60_000, since: new Date(0) });
      expect([...collected].map(([member, arrival]) => [member, arrival.text])).toEqual([[h.source.id, 'Collected answer']]);
    }),
  );
  it.effect(
    'standing reports arrive whole and distinguish final answers from run endings',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.source.id, { assignment: 'running', life: 'working' });
      h.setDirectory(h.peer.id, { assignment: 'running', life: 'working' });
      const final = 'The probe held.\n\nEvery measurement follows, whole.';
      const ending = 'The last message of a run that stopped.\nIts evidence remains available.';
      yield* h.envelopes.deliver(h.parent, { id: 'envelope:final:req-1', senderThreadId: h.source.id, intent: 'report', text: final });
      yield* h.envelopes.deliver(h.parent, {
        id: 'envelope:report:req-2:run-2',
        senderThreadId: h.peer.id,
        intent: 'report',
        text: ending,
      });
      const waited = yield* h.wait(h.parent, [h.source.id, h.peer.id], 60_000);
      expect(waited.arrived.map((arrival) => [arrival.from, arrival.report, arrival.text])).toEqual([
        [h.source.id, 'final', final],
        [h.peer.id, 'end', ending],
      ]);
      expect(waited.expired).toBe(false);
    }),
  );
  it.effect(
    'collection reads past ordinary words and finishes when the other member ends silent',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.setDirectory(h.source.id, { assignment: 'running', life: 'working' });
      h.setDirectory(h.peer.id, { assignment: 'running', life: 'working' });
      const final = 'The whole answer of the worker.\n\nEvery finding is here.';
      const collecting = yield* Effect.forkScoped(
        h.envelopes.access(h.parent).collect({ from: [h.source.id, h.peer.id], deadlineMs: 60_000, since: new Date(0) }),
      );
      yield* h.waitRead;
      yield* h.send(h.source, { to: h.parent.id, intent: 'message', text: 'halfway there' });
      yield* h.envelopes.deliver(h.parent, { id: 'envelope:final:req-1', senderThreadId: h.source.id, intent: 'report', text: final });
      h.setDirectory(h.peer.id, { assignment: 'completed', life: 'idle' });
      yield* h.complete(completed('run-peer', h.peer.id));
      expect([...(yield* Fiber.join(collecting))].map(([member, arrival]) => [member, arrival.report, arrival.text])).toEqual([
        [h.source.id, 'final', final],
      ]);
    }),
  );
  for (const pace of ['one at a time', 'all at once'] as const)
    it.effect(
      `collection retains each child report, ${pace}`,
      Effect.fnUntraced(function* () {
        const h = yield* envelopeHarness();
        const kids = h.crowd(2);
        const collecting = yield* Effect.forkScoped(
          h.envelopes.access(h.parent).collect({ from: kids.map((kid) => kid.id), deadlineMs: 60_000, since: new Date(0) }),
        );
        yield* h.waitRead;
        yield* Effect.forEach(kids, (kid) => h.finish(kid, `${kid.id} is done`), { concurrency: pace === 'one at a time' ? 1 : 2 });
        const reports = yield* Fiber.join(collecting);
        expect(reports.size).toBe(2);
        expect(kids.map((kid) => reports.get(kid.id)?.text)).toEqual(kids.map((kid) => `${kid.id} is done`));
      }),
    );
});
const HELD = 150_000;
const READING = {
  usage: { inputTokens: HELD },
  contextWindow: 1_000_000,
  runId: 'run-handled',
  stepNumber: 3,
  provider: fixtureSelection.provider,
  model: fixtureSelection.model,
  measuredAt: '2026-08-31T20:00:00.000Z',
  stale: false,
} as unknown as ThreadContextReading;
const warmthOf = (over: Partial<ThreadCacheWarmth> = {}): ThreadCacheWarmth => ({
  state: 'cold',
  heldTokens: HELD,
  basis: 'promise',
  expiresAt: '2026-08-31T20:05:00.000Z',
  gap: null,
  warmShare: null,
  sample: null,
  oldestAt: null,
  invalidatedBy: null,
  ...over,
});
describe('a send to an idle descendant whose cache is surely cold', () => {
  it.effect(
    'refuses cold-wake and sends nothing; with wake: true it wakes the child and names what it rewrote',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.rest(h.source.id, warmthOf());
      const stored = h.count();
      expect(yield* h.send(h.parent, { to: h.source.id, intent: 'message', text: 'the plan moved' })).toEqual({
        status: 'refused',
        code: 'cold-wake',
        cold: [{ threadId: h.source.id, name: h.source.name, tokens: HELD }],
      });
      expect(h.count()).toBe(stored);
      expect(h.sent).toEqual([]);
      expect(
        yield* only(yield* h.send(h.parent, { to: h.source.id, intent: 'message', text: 'the plan moved', wake: true })),
      ).toMatchObject({
        status: 'woken',
        cache: 'cold · 150k rewritten',
      });
    }),
  );
  it.effect(
    'an estimated cold is sent with its word, and with the refusal switched off a sure cold wakes with its price',
    Effect.fnUntraced(function* () {
      const estimated = yield* envelopeHarness();
      estimated.rest(estimated.source.id, warmthOf({ basis: 'prior', expiresAt: null }));
      expect(
        yield* only(yield* estimated.send(estimated.parent, { to: estimated.source.id, intent: 'task', text: 'review it' })),
      ).toMatchObject({
        status: 'woken',
        cache: 'estimated cold · 150k',
      });
      const off = yield* envelopeHarness({ coldWake: { refuse: false, tokens: 100_000 } });
      off.rest(off.source.id, warmthOf());
      expect(yield* only(yield* off.send(off.parent, { to: off.source.id, intent: 'task', text: 'review it' }))).toMatchObject({
        status: 'woken',
        cache: 'cold · 150k rewritten',
      });
    }),
  );
  it.effect(
    'a final answer of a child reaches its cold parent',
    Effect.fnUntraced(function* () {
      const h = yield* envelopeHarness();
      h.rest(h.parent.id, warmthOf());
      yield* h.task('envelope:spawn', h.source.id, h.parent.id, 'run-1');
      expect(yield* only(yield* h.send(h.source, { to: 'parent', intent: 'message', text: 'Done.', final: true }))).toMatchObject({
        recipient: { threadId: h.parent.id },
        closed: ['envelope:spawn'],
      });
    }),
  );
});
describe('a report names the context its child holds', () => {
  it.effect(
    'a promised expiry adds warm-until, another basis names the size alone, and a final still settles by its words',
    Effect.fnUntraced(function* () {
      const promised = yield* envelopeHarness();
      promised.measure(promised.source.id, warmthOf({ state: 'warm', expiresAt: '2026-08-31T20:47:00.000Z' }), READING);
      yield* promised.task('envelope:spawn:call-1', promised.source.id, promised.parent.id, 'run-handled');
      yield* promised.complete(completed('run-handled', promised.source.id), { reading: READING });
      const [report] = promised.reports();
      expect(agentSignalMarkup(threadSignalOfInboxItem(report!))).toContain(' context="150k" warm-until="20:47Z">');
      const estimated = yield* envelopeHarness();
      estimated.measure(estimated.source.id, warmthOf({ state: 'warm', basis: 'local', expiresAt: null }), READING);
      yield* estimated.task('envelope:spawn', estimated.source.id, estimated.parent.id, 'run-1');
      const ask = { to: ['parent'], intent: 'message' as const, text: 'Done.', final: true, key: 'final-sized' };
      yield* estimated.send(estimated.source, ask);
      const [final] = estimated.reports();
      expect(agentSignalMarkup(threadSignalOfInboxItem(final!))).toMatch(/ context="150k">/);
      expect(yield* estimated.settle(estimated.source, ask)).toMatchObject({ status: 'completed' });
    }),
  );
});
type Settled = {
  readonly runId: string;
  readonly threadId: string;
  readonly status: RunEnded['status'];
  readonly failureReason: string | null;
  readonly failure: RunEnded['failure'];
  readonly stoppedBy: RunEnded['stoppedBy'];
};
function completed(runId: string, threadId: string): Settled {
  return { runId, threadId, status: 'completed', failureReason: null, failure: null, stoppedBy: null };
}
function ended(event: Settled, over: Partial<RunEnded> = {}): RunEnded {
  return {
    ...event,
    principal: 'owner',
    ending: event.runId,
    kind: 'ended',
    work: 'turn',
    handled: null,
    answer: 'The work is complete.',
    report: null,
    reading: null,
    ...over,
  };
}
const envelopeHarness = Effect.fnUntraced(function* (
  configuration: {
    reconcileIntervalMs?: number;
    remoteActive?: boolean;
    acceptance?: ThreadInputAcceptance;
    pairDelivery?: true;
    coldWake?: ColdWakeRule;
  } = {},
) {
  const parent = row('parent', null);
  const peer = row('peer', null);
  const source = row('worker', parent.id);
  const records = new Map([parent, peer, source].map((entry) => [entry.id, entry]));
  const published: string[] = [];
  const memory = new ThreadMemory(makeThreadEntryReader({ products: [] }));
  const ledger = inMemoryInboxStorage({ units: memory.units, calls: memory.records });
  const sent: {
    recipient: ThreadRecord;
    signal: ThreadSignal;
  }[] = [];
  const working = new Set<string>();
  const owing = new Set<string>();
  const queuedTasks: ThreadSignal[] = [];
  const woken: ThreadSignal[] = [];
  const moved = new Date('2026-08-31T20:00:00.000Z');
  const directoryEntries = new Map([...records.values()].map((entry) => [entry.id, directoryEntryOf(entry, moved)]));
  const reads = yield* Queue.unbounded<void>();
  let nextDeliveryDies: unknown = null;
  const unreachable = new Set<string>();
  let afterDirectory: (() => void) | null = null;
  let afterRead: Effect.Effect<void> | null = null;
  let beforeUnit: Effect.Effect<void> | null = null;
  const measured: { warmth: ThreadCacheWarmth | null } = { warmth: null };
  const measuredRows = new Map<string, Pick<ThreadDirectoryRow, 'selection' | 'contextReading'>>();
  const storage = threadStorageLayer({
    storage: makeMemoryRows({ memory }),
    eventLog: makeMemoryEvents({ memory }),
    transitions: inMemoryThreadTransitions({ memory }),
    createRuns: (owner) => makeMemoryRuns({ memory, ownerId: owner, scope: null }),
    inbox: ledger,
    ownerSettings: makeMemoryOwnerSettings({ memory }),
    attachments: { keep: unused, hydrate: unused, resolve: unused, addressed: unused, sizes: unused },
    toolOutputs: { scope: () => ({ ...emptyToolOutputs, commitReferenced: unused }), settleOpen: unused },
  });
  const baseContext = yield* Layer.build(Layer.merge(storage, threadChangesLayer));
  const base = Context.get(baseContext, ThreadInbox);
  const changes = Context.get(baseContext, ThreadChanges);
  const paired = yield* Deferred.make<void>();
  let accepted = 0;
  const inbox = ThreadInbox.of({
    ...base,
    put: Effect.fnUntraced(function* (values, tx) {
      const result = yield* base.put(values, tx);
      if (configuration.pairDelivery) {
        if (++accepted === 2) yield* Deferred.succeed(paired, undefined);
        yield* Deferred.await(paired);
      }
      return result;
    }),
    control: Effect.fnUntraced(function* <A>(
      threadId: string,
      plan: InboxPlan<A>,
      call: {
        readonly key: Keyed;
        readonly deadline: Date;
      },
    ) {
      const staged = beforeUnit;
      beforeUnit = null;
      if (staged) yield* staged;
      const result = yield* base.control(threadId, plan, call);
      if ('committed' in result) published.push(threadId);
      return result;
    }),
    arrivals: Effect.fnUntraced(function* (input, tx) {
      const result = yield* base.arrivals(input, tx);
      const hook = afterRead;
      afterRead = null;
      if (hook) yield* hook;
      yield* Queue.offer(reads, undefined);
      return result;
    }),
  });
  const directory = ThreadDirectory.of({
    access: () => ({
      list: (query) =>
        Effect.sync(() => {
          const wanted = query.ids === undefined ? null : new Set(query.ids);
          const listed = [...directoryEntries.values()].filter((entry) => wanted === null || wanted.has(entry.threadId));
          const after = afterDirectory;
          afterDirectory = null;
          after?.();
          return { rows: listed, total: listed.length, cursor: null };
        }),
    }),
    warmth: (subjects) => Effect.succeed(subjects.map(() => measured.warmth)),
  });
  const threads = Threads.of({
    find: (id, principal) => Effect.succeed(records.get(id)?.principal === principal ? records.get(id)! : null),
    named: (principal, root, name) =>
      Effect.succeed(
        [...records.values()].find((entry) => entry.principal === principal && entry.spawnRootId === root && entry.name === name) ?? null,
      ),
    list: (query) =>
      Effect.succeed({
        rows: [...records.values()]
          .filter((entry) => entry.principal === query.principal)
          .map((entry) => ({ ...directoryRow(entry, moved), ...measuredRows.get(entry.id) })),
        total: records.size,
        cursor: null,
      }),
    watch: changes.watch,
    lineage: unused,
    readBirth: unused,
    create: unused,
  });
  const runs = ThreadRuns.of({
    current: () => Effect.succeed(null),
    stopReceipt: unused,
    start: unused,
    continue: unused,
    stop: unused,
    deliver: Effect.fnUntraced(
      function* (threadId, input) {
        const item = (yield* ledger.receipt(input.item.id)) ?? input.item;
        if (item.state !== 'queued')
          return {
            status:
              item.deliveredToRunId === null ? ('stored' as const) : item.kind === 'task' ? ('queued' as const) : ('delivered' as const),
            runId: item.deliveredToRunId,
            acted: false,
            acceptance: configuration.acceptance,
          };
        if (nextDeliveryDies !== null) {
          const cause = nextDeliveryDies;
          nextDeliveryDies = null;
          return yield* Effect.die(cause);
        }
        if (unreachable.has(threadId))
          return yield* new ThreadRunUnavailable({ threadId, reason: 'not-ready', cause: new Error('the recipient run would not open') });
        if (item.kind !== 'task' && item.kind !== 'envelope') return yield* unused();
        const signal = threadSignalOfInboxItem(item);
        const active = working.has(threadId);
        const runId = `${active ? 'active' : 'woken'}:${threadId}`;
        if (item.kind === 'task' && item.body.intent === 'interrupt') {
          if (!active) {
            yield* ledger.acknowledge([item.id], null);
            return { status: 'stored' as const, runId: null, acted: true, acceptance: configuration.acceptance };
          }
          queuedTasks.push(signal);
          return { status: 'queued' as const, runId, acted: true, acceptance: configuration.acceptance };
        }
        if (item.kind === 'task') {
          if (active && queuedTasks.some((queued) => queued.id === item.id))
            return { status: 'queued' as const, runId, acted: false, acceptance: configuration.acceptance };
          if (active) queuedTasks.push(signal);
          else woken.push(signal);
          return { status: active ? ('queued' as const) : ('woken' as const), runId, acted: true, acceptance: configuration.acceptance };
        }
        sent.push({ recipient: records.get(threadId)!, signal });
        yield* ledger.deliver([item.id], runId);
        yield* changes.publish(threadId);
        return {
          status: active ? (configuration.remoteActive ? ('queued' as const) : ('delivered' as const)) : ('woken' as const),
          runId,
          acted: true,
          acceptance: configuration.acceptance,
        };
      },
      (effect, threadId, input) =>
        effect.pipe(
          Effect.mapError((failure) =>
            failure instanceof ThreadRunUnavailable ? failure : storageFailed('envelope-test.deliver')(failure),
          ),
        ),
    ),
  });
  const recording = activityRecording();
  const endings = inMemoryEndingStages();
  const context = yield* Layer.build(
    threadEnvelopesLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(Threads, threads),
          Layer.succeed(ThreadRuns, runs),
          Layer.succeed(EndingStages, endings),
          Layer.succeed(ThreadInbox, inbox),
          Layer.succeed(ThreadResting, null),
          Layer.succeed(ThreadOwnWork, { owed: (threadId) => Effect.succeed(owing.has(threadId)), endings: new Set([OWN_ENDING]) }),
          Layer.succeed(ThreadDirectory, directory),
          Layer.succeed(
            ContextCompaction,
            ContextCompaction.of({ choosesSummarizer: false, summarizer: unused, compact: unused, compactAhead: unused }),
          ),
          Layer.succeed(
            DeclaredCollaboration,
            DeclaredCollaboration.of({
              models: () => modelCatalog([]),
              subAgentDepth: () => Effect.succeed(2),
              delegation: () => Effect.succeed({ allowed: true, setAt: null }),
              coldWake: configuration.coldWake === undefined ? undefined : () => Effect.succeed(configuration.coldWake!),
              reconcileIntervalMs: configuration.reconcileIntervalMs ?? 30_000,
            }),
          ),
          Layer.succeed(ActivityLog, recording.log),
        ),
      ),
    ),
  );
  const envelopes = Context.get(context, ThreadEnvelopes);
  let keys = 0;
  const complete = (event: Settled, over: Partial<RunEnded> = {}) =>
    Effect.tap(Effect.provideService(envelopes.completeRun(ended(event, over)), ActivityLog, recording.log), () =>
      changes.publish(event.threadId),
    );
  const request = Effect.fnUntraced(function* (
    id: string,
    threadId: string,
    senderId: string,
    runId: string | null,
    intent: 'task' | 'interrupt',
  ) {
    yield* ledger.put({
      ...taskItem(id, threadId, senderId),
      body: { intent, text: `Work requested by ${senderId}`, inReplyTo: null },
      occurredAt: '2026-08-31T20:05:00.000Z',
    });
    if (runId !== null) yield* ledger.deliver([id], runId);
  });
  return {
    parent,
    peer,
    source,
    envelopes,
    endings,
    inbox,
    ledger,
    sent,
    recording,
    published,
    working,
    owing,
    queuedTasks,
    woken,
    unreachable,
    row: (id: string) => ledger.items.get(id),
    reports: () =>
      [...ledger.items.values()].filter(
        (
          item,
        ): item is Extract<
          ThreadInboxItem,
          {
            kind: 'envelope';
          }
        > => item.kind === 'envelope' && item.body.intent === 'report',
      ),
    count: () => ledger.items.size,
    closure: (id: string) => ledger.closed.get(id)?.by,
    task: (id: string, threadId: string, senderId: string, runId: string) =>
      Effect.andThen(ledger.put(taskItem(id, threadId, senderId)), ledger.deliver([id], runId)),
    report: (id: string, threadId: string, senderId: string, runId: string) =>
      Effect.andThen(
        ledger.put({
          ...taskItem(id, threadId, senderId),
          kind: 'envelope',
          body: { intent: 'report', text: `Report from ${senderId}`, inReplyTo: null },
        }),
        ledger.deliver([id], runId),
      ),
    pend: Effect.fnUntraced(function* (runId: string, threadId: string) {
      const unit = new MemoryTx({ clock: yield* Clock.Clock });
      yield* endings.record(ended(completed(runId, threadId)), unit as unknown as ThreadWriteTx);
      yield* Effect.forEach(unit.end(), (tail) => tail, { discard: true });
    }),
    acceptedTask: (id: string, threadId: string, senderId: string) => Effect.asVoid(ledger.put(taskItem(id, threadId, senderId))),
    request,
    bind: ledger.deliver,
    carry: (from: string, to: string) =>
      Effect.suspend(() =>
        ledger.deliver(
          [...ledger.items.values()]
            .filter((item) => item.state === 'delivered' && item.deliveredToRunId === from && item.kind === 'task')
            .map((item) => item.id),
          to,
        ),
      ),
    failNextSend: (cause: unknown) => {
      nextDeliveryDies = cause;
    },
    beforeUnit: (work: Effect.Effect<void>) => {
      beforeUnit = work;
    },
    afterRead: (work: Effect.Effect<void>) => {
      afterRead = work;
    },
    waitRead: Queue.take(reads),
    afterDirectoryRead: (work: () => void) => {
      afterDirectory = work;
    },
    crowd: (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const child = row(`kid-${index}`, parent.id);
        records.set(child.id, child);
        directoryEntries.set(child.id, { ...directoryEntryOf(child, moved), assignment: 'running', life: 'working' });
        return child;
      }),
    rename: (thread: ThreadRecord, name: string) => {
      records.set(thread.id, { ...thread, name });
    },
    rest: (threadId: string, warmth: ThreadCacheWarmth) => {
      directoryEntries.set(threadId, { ...directoryEntries.get(threadId)!, life: 'idle', warmth });
    },
    measure: (threadId: string, warmth: ThreadCacheWarmth, reading: ThreadContextReading) => {
      measured.warmth = warmth;
      measuredRows.set(threadId, { contextReading: reading, selection: { ...fixtureSelection, account: null } });
    },
    setDirectory: (
      threadId: string,
      state: {
        readonly assignment: ThreadDirectoryEntry['assignment'];
        readonly life: ThreadDirectoryEntry['life'];
      } | null,
    ) => {
      if (state === null) {
        directoryEntries.delete(threadId);
        return;
      }
      const entry = directoryEntries.get(threadId);
      if (!entry) throw new Error(`No directory entry for ${threadId}`);
      directoryEntries.set(threadId, { ...entry, ...state });
    },
    finish: Effect.fnUntraced(function* (child: ThreadRecord, report: string) {
      directoryEntries.set(child.id, { ...directoryEntries.get(child.id)!, assignment: 'completed', life: 'idle' });
      yield* envelopes.deliver(parent, { id: `envelope:report:${child.id}`, senderThreadId: child.id, intent: 'report', text: report });
      yield* changes.publish(child.id);
    }),
    send: (
      sender: ThreadRecord,
      input: {
        to: string | readonly string[];
        intent: 'message' | 'task' | 'interrupt';
        text: string;
        final?: boolean;
        inReplyTo?: string;
        key?: string;
        wake?: boolean;
      },
      runId?: string,
    ) =>
      Effect.provideService(
        envelopes
          .access(sender, runId)
          .send({ ...input, key: input.key ?? `call-${++keys}`, to: typeof input.to === 'string' ? [input.to] : input.to }),
        ActivityLog,
        recording.log,
      ),
    settle: (
      sender: ThreadRecord,
      input: {
        to: readonly string[];
        intent: 'message' | 'task' | 'interrupt';
        text: string;
        key: string;
        final?: boolean;
      },
      ahead = false,
    ) => envelopes.access(sender).settle(input, ahead),
    deliver: (
      recipient: ThreadRecord,
      envelope: {
        id: string;
        intent: 'message' | 'task' | 'report';
        text: string;
      },
    ) => envelopes.deliver(recipient, { ...envelope, senderThreadId: source.id }),
    wait: (sender: ThreadRecord, from: readonly string[], deadlineMs: number, since = new Date(0)) =>
      envelopes.access(sender).waitFor({ from, deadlineMs, since }),
    withdraw: (thread: ThreadRecord, inputId: string) => envelopes.withdrawRequest(thread.id, thread.principal, inputId),
    complete,
  };
});
function taskItem(
  id: string,
  threadId: string,
  senderThreadId: string,
): Extract<
  ThreadInboxItem,
  {
    kind: 'task';
  }
> {
  return {
    id,
    threadId,
    sender: { kind: 'thread', threadId: senderThreadId, name: senderThreadId },
    kind: 'task',
    body: { intent: 'task', text: `Work requested by ${senderThreadId}`, inReplyTo: null },
    state: 'queued',
    deliveredToRunId: null,
    occurredAt: '2026-08-31T20:00:00.000Z',
  };
}
function row(id: string, parentThreadId: string | null): ThreadRecord {
  return {
    id,
    principal: 'owner',
    agentId: id,
    typeId: null,
    name: id,
    spawnRootId: parentThreadId ?? id,
    parentThreadId,
    spawnedByRunId: null,
    bornOf: null,
    createdBy: null,
    harness: 'native',
    host: null,
    authority: { mode: 'trust', bypassFrom: null },
    plain: false,
    budgetTokens: null,
    capabilities: NATIVE_CAPABILITIES,
    model: fixtureSelection,
    profile: null,
  };
}
function directoryEntryOf(entry: ThreadRecord, moved: Date): ThreadDirectoryEntry {
  return {
    threadId: entry.id,
    projectId: null,
    agentId: entry.agentId,
    name: entry.name,
    spawnRootId: entry.spawnRootId,
    parentThreadId: entry.parentThreadId,
    selection: null,
    assignment: 'never-started',
    failureReason: null,
    failure: null,
    life: 'idle',
    askPrompt: null,
    context: null,
    warmth: null,
    movedAt: moved.toISOString(),
    stalledSince: null,
  };
}
function directoryRow(entry: ThreadRecord, movedAt: Date): ThreadDirectoryRow {
  return {
    threadId: entry.id,
    projectId: null,
    agentId: entry.agentId,
    typeId: entry.typeId ?? entry.agentId,
    name: entry.name,
    spawnRootId: entry.spawnRootId,
    parentThreadId: entry.parentThreadId,
    spawnedByRunId: entry.spawnedByRunId,
    movedAt,
    selection: null,
    provider: null,
    capabilities: entry.capabilities,
    contextReading: null,
    run: null,
    assignment: null,
    failureReason: null,
    failure: null,
  };
}
const only = (answer: Effect.Success<ReturnType<ReturnType<ThreadEnvelopes['Service']['access']>['send']>>) => {
  if (!('deliveries' in answer)) return Effect.die('Expected a sent envelope');
  const [delivery, ...more] = answer.deliveries;
  return delivery !== undefined && more.length === 0 ? Effect.succeed(delivery) : Effect.die('Expected exactly one delivery');
};
const rejection = <A, E>(work: Effect.Effect<A, E>) => Effect.map(Effect.flip(work), (failure) => planeRefusalOf(failure)?.code);
