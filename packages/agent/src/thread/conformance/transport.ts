import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Deferred, Effect, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { ThreadStateChange } from '../state';
import { Message } from '@runlith/llm/schema/messages';
import { Usage } from '@runlith/llm/schema/events';
import { assistantMessageEntryId, hostedToolEntryId, retryEntryId } from '../../transcript/entryNames';
import type { ThreadOpenChange } from '../../transcript/live';
import { coreEntry, entryOf } from '../../transcript/kinds';
import type { ThreadRunRef } from '../run/ThreadRunLedger';
import { readThreadEvents, threadSignalOpening, threadSpokenToolEvent, threadUserMessageEvent, type ThreadEventBody } from '../events';
import { threadSignalOfInboxItem } from '../inboxItems';
import { REPORT_WINDOW, reportKey } from '../keyed';
import { NATIVE_CAPABILITIES } from '../record';
import type { ThreadRunRow } from '../rows';
import { unreadReportEnvelope, type ReportPlan } from '../run/lifecycle/RunReports';
import type { ThreadWriteTx } from '../ThreadPorts';
import { THREAD_REQUEST_DETACHED } from '../storage/inbox';
import type { RunLaunch } from '../transport/contract';
import { silentGuidance } from './fakeTransport';
import { APPROVAL, lifecycleWorld, lifecycleWorldOver, type LifecycleWorld, SCOPE, started } from './lifecycleWorld';
import { until } from './runLog/support';
import type { ThreadStorageFactory } from './storagePort';
import { describeTransportRuns, type RunsHarness } from './transportRuns';
const ADAPTER = 'native';
export function describeTransportContract<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describeTransportRuns(`${name}: the fake adapter`, () => fakeRuns(open), test);
  describe(`${name}: transport contract over the storage`, () => {
    test(
      'a report applies once: its repeat is a replay, and a report to an ended run is settled and writes nothing',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const words = [threadUserMessageEvent({ id: run.id }, { text: 'tail', reader: false })];
        const kinds = () =>
          Effect.map(readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 1_000), (events) =>
            events.map((event) => event.kind),
          );
        expect((yield* report(world, reports.recorded(run, words, 'stdout:10'))).status).toBe('applied');
        expect((yield* report(world, reports.recorded(run, words, 'stdout:10'))).status).toBe('replayed');
        expect(yield* kinds()).toEqual(['message']);
        expect((yield* report(world, reports.ended(run, { kind: 'completed' }))).status).toBe('applied');
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'completed' });
        expect((yield* report(world, reports.ended(run, { kind: 'failed', reason: 'late exit' }))).status).toBe('settled');
        expect((yield* report(world, reports.recorded(run, words, 'stdout:11'))).status).toBe('settled');
        expect(yield* kinds()).toEqual(['message', 'run-end']);
      }),
    );
    test(
      'a report contributes its phase and later tail in write order at the committed stamp',
      Effect.fnUntraced(function* () {
        const base = yield* Clock.Clock;
        let stamp = 0;
        const next = () => ++stamp;
        const clock: Clock.Clock = {
          currentTimeMillisUnsafe: next,
          currentTimeMillis: Effect.sync(next),
          currentTimeNanosUnsafe: () => base.currentTimeNanosUnsafe(),
          currentTimeNanos: base.currentTimeNanos,
          monotonicTimeNanosUnsafe: () => base.monotonicTimeNanosUnsafe(),
          monotonicTimeNanos: base.monotonicTimeNanos,
          sleep: (duration) => base.sleep(duration),
        };
        yield* Effect.provideService(
          Effect.gen(function* () {
            const world = yield* lifecycleWorld(open, 30_000, 250);
            const run = yield* opened(world);
            const reports = world.reports.of(ADAPTER);
            yield* reports.live(run, { op: 'phase', phase: 'reasoning' });
            yield* reports.live(run, { op: 'append', stream: 'message', part: 0, text: 'Open words.' });
            const handed: ThreadStateChange[] = [];
            world.changes.project((change) => Effect.sync(() => void handed.push(change)));
            const write = Effect.fnUntraced(function* (unit: TWrite) {
              yield* world.storage.transitions.opened([run.threadId], unit);
              world.changes.claim(run.threadId, unit as object);
              yield* reports.recorded(run, [], 'phase-tail').run(unit as ThreadWriteTx);
              yield* world.storage.transitions.revised([run.threadId], unit, (revisions) =>
                world.changes.settle(run.threadId, unit as object, revisions.get(run.threadId)),
              );
            });
            if (world.storage.aggregate.program === undefined || (yield* world.storage.aggregate.program('phase-tail', write)) === null) {
              yield* world.storage.aggregate.transaction(write);
            }
            const stored = yield* world.runs.runById(run.id);
            const patches = handed.flatMap((change) => (change.kind === 'moved' ? [] : (change.runs ?? [])));
            expect(patches).toEqual([
              {
                id: run.id,
                progress: stored?.progress,
                streamTail: stored?.streamTail,
                heartbeatAt: stored?.heartbeatAt,
                updatedAt: stored?.updatedAt,
                resumes: stored?.resumes,
              },
            ]);
          }),
          Clock.Clock,
          clock,
        );
      }, Effect.provide(TestClock.layer())),
    );
    test(
      'the evidence of a report stands in the storage across a restart, is bounded per run, and goes with the run',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const standing = (mark: string, over = world) =>
          Effect.map(over.storage.transitions.readRecord(run.threadId, { call: reportKey(run.id, mark) }), (record) => record.kind);
        yield* report(world, reports.recorded(run, [], 'mark:0'));
        expect(yield* standing('mark:0')).toBe('present');
        const thread = (yield* world.storage.aggregate.find(run.threadId))!;
        yield* world.dispose();
        const later = yield* lifecycleWorldOver(yield* world.storage.reopen(), thread);
        expect((yield* report(later, later.reports.of(ADAPTER).recorded(run, [], 'mark:0'))).status).toBe('replayed');
        for (let mark = 1; mark <= REPORT_WINDOW + 2; mark += 1)
          yield* report(later, later.reports.of(ADAPTER).recorded(run, [], `mark:${mark}`));
        expect(yield* standing('mark:0', later)).not.toBe('present');
        expect(yield* standing(`mark:${REPORT_WINDOW + 2}`, later)).toBe('present');
        yield* report(later, later.reports.of(ADAPTER).ended(run, { kind: 'completed' }));
        expect(yield* standing(`mark:${REPORT_WINDOW + 2}`, later)).not.toBe('present');
      }),
    );
    test(
      'a report waits for adoption when another process owns the run',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const elsewhere = world.storage.runs({ ownerId: 'elsewhere', scope: SCOPE });
        const run = started(
          yield* elsewhere.createRun({
            startFrom: world.startFrom,
            kind: 'turn',
            approval: APPROVAL,
            progress: { stage: null, message: null },
          }),
        ).run;
        const reports = world.reports.of(ADAPTER);
        expect((yield* report(world, reports.recorded(run, [], 'stdout:1'))).status).toBe('unowned');
        expect(yield* Effect.flip(attempt(world, reports.ended(run, { kind: 'completed' })))).toMatchObject({
          _tag: 'RunActRefused',
          state: 'foreign',
        });
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running', ownerId: 'elsewhere' });
      }),
    );
    test(
      'a failed end names its reason and an aborted end names who stopped it',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const reports = world.reports.of(ADAPTER);
        const failing = yield* opened(world);
        yield* report(world, reports.ended(failing, { kind: 'failed', reason: 'the process died' }));
        expect(yield* world.runs.runById(failing.id)).toMatchObject({ status: 'failed', failureReason: 'the process died' });
        const aborted = yield* opened(world);
        yield* report(world, reports.ended(aborted, { kind: 'aborted', stoppedBy: 'reader' }));
        expect(yield* world.runs.runById(aborted.id)).toMatchObject({ status: 'aborted', settledBy: 'reader' });
      }),
    );
    test(
      'a report and a core end racing over one run both settle: one end stands, and the loser is a settled report',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const words = [threadUserMessageEvent({ id: run.id }, { text: 'tail', reader: false })];
        const [reported, finished] = yield* Effect.all(
          [report(world, world.reports.of(ADAPTER).recorded(run, words, 'stdout:1')), world.lifecycle.finish(run, { kind: 'completed' })],
          { concurrency: 2 },
        );
        expect(finished === 'committed' || finished === 'replayed').toBe(true);
        expect(['applied', 'settled']).toContain(reported.status);
        const events = yield* readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 1_000);
        expect(events.filter((event) => event.kind === 'run-end')).toHaveLength(1);
        expect(events.filter((event) => event.kind === 'message')).toHaveLength(reported.status === 'applied' ? 1 : 0);
      }),
    );
    test(
      'a report from an adapter the thread is not bound to is refused, and a missing thread is a different refusal',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const foreign = yield* Effect.flip(attempt(world, world.reports.of('terminal').ended(run, { kind: 'completed' })));
        const missing = yield* Effect.flip(
          attempt(world, world.reports.of(ADAPTER).recorded({ id: run.id, threadId: 'no-such-thread' }, [], 'stdout:1')),
        );
        expect(foreign).toMatchObject({ _tag: 'ForeignBinding', adapter: 'terminal', threadId: run.threadId });
        expect(missing).toMatchObject({ _tag: 'ThreadNotFound' });
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running' });
      }),
    );
    test(
      'an observed turn is opened only where the thread admits it, once per evidence, marking the run observed and withdrawing the unread run it displaces',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const reports = world.reports.of(ADAPTER);
        const unread = yield* opened(world);
        const turn = (displaces: string | null) => ({
          displaces,
          approval: APPROVAL,
          entries: (runId: string) => [threadUserMessageEvent({ id: runId }, { text: 'typed by a person', reader: false })],
        });
        expect(yield* Effect.flip(attempt(world, reports.observed(unread.threadId, turn(unread.id), 'prompt:1')))).toMatchObject({
          _tag: 'OpeningsRefused',
          adapter: ADAPTER,
        });
        expect(yield* world.runs.runById(unread.id)).toMatchObject({ status: 'running' });
        yield* world.storage.aggregate.update(unread.threadId, { capabilities: { ...NATIVE_CAPABILITIES, openings: 'core-and-observed' } });
        const seen = yield* report(world, reports.observed(unread.threadId, turn(unread.id), 'prompt:1'));
        const again = yield* report(world, reports.observed(unread.threadId, turn(unread.id), 'prompt:1'));
        expect(seen.status).toBe('applied');
        expect(again).toEqual({ status: 'replayed', runId: seen.runId });
        expect(yield* world.runs.runById(unread.id)).toMatchObject({ status: 'withdrawn', origin: 'core' });
        expect(yield* world.runs.runById(seen.runId)).toMatchObject({ status: 'running', origin: 'observed' });
      }),
    );
    test(
      'an observed run is beaten for as long as its adapter holds it',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open, 20);
        const reports = world.reports.of(ADAPTER);
        const unread = yield* opened(world);
        yield* world.storage.aggregate.update(unread.threadId, { capabilities: { ...NATIVE_CAPABILITIES, openings: 'core-and-observed' } });
        const seen = yield* report(
          world,
          reports.observed(
            unread.threadId,
            {
              displaces: unread.id,
              approval: APPROVAL,
              entries: (runId: string) => [threadUserMessageEvent({ id: runId }, { text: 'typed by a person', reader: false })],
            },
            'prompt:beat',
          ),
        );
        world.adapter.held.add(seen.runId);
        const first = (yield* world.runs.runById(seen.runId))!.heartbeatAt.getTime();
        yield* until(() => Effect.map(world.runs.runById(seen.runId), (run) => run!.heartbeatAt.getTime() > first));
      }),
    );
    test(
      'a step carries the context reading and a stale mark keeps it, and an end stores the unreported spend and the vendor cost of its run',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const reading = {
          usage: Usage.from({ inputTokens: 40, totalTokens: 40 }),
          contextWindow: 200,
          runId: run.id,
          stepNumber: 0,
          provider: 'claude-code',
          model: null,
          measuredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          stale: false,
        };
        const held = () => Effect.map(world.storage.aggregate.find(run.threadId), (row) => row?.contextReading);
        const sent = { ...reading, sentAt: new Date(yield* Clock.currentTimeMillis).toISOString(), cache: { ttlSeconds: 3600 } };
        yield* report(world, reports.recorded(run, [], 'stdout:0', { reading: { kind: 'measured', reading: sent } }));
        yield* report(world, reports.recorded(run, [], 'stdout:00', { reading: { kind: 'measured', reading } }));
        expect(yield* held()).toMatchObject({ contextWindow: 200, stale: false, sentAt: sent.sentAt, cache: { ttlSeconds: 3600 } });
        yield* report(world, reports.recorded(run, [], 'stdout:1', { reading: { kind: 'measured', reading } }));
        expect(yield* held()).toMatchObject({ contextWindow: 200, stale: false });
        yield* report(world, reports.recorded(run, [], 'stdout:2', { reading: { kind: 'stale' } }));
        expect(yield* held()).toMatchObject({ contextWindow: 200, stale: true });
        const spent = Usage.from({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
        const cost = { amount: 0.25, currency: 'USD', basis: 'list' };
        yield* report(world, reports.ended(run, { kind: 'completed' }, { rest: spent, cost }));
        const ended = yield* world.runs.runById(run.id);
        expect(ended?.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
        expect(ended?.cost).toEqual(cost);
      }),
    );
    test(
      'live deltas open the tail of a run, a step that writes their entries lands them, and the end closes the rest',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const shown = () => world.feed.view(run.threadId).open.map((entry) => [entry.id, 'text' in entry ? entry.text : null]);
        const first = assistantMessageEntryId(run.id, 0);
        const second = assistantMessageEntryId(run.id, 1);
        yield* reports.live(run, { op: 'append', stream: 'message', part: 0, text: 'Hel' });
        yield* reports.live(run, { op: 'append', stream: 'message', part: 0, text: 'lo' });
        expect(shown()).toEqual([[first, 'Hello']]);
        yield* reports.live(run, { op: 'seal', stream: 'message', part: 0 });
        yield* reports.live(run, { op: 'append', stream: 'message', part: 1, text: 'World' });
        expect(shown()).toEqual([
          [first, 'Hello'],
          [second, 'World'],
        ]);
        const said: ThreadEventBody = {
          kind: 'message',
          payload: {
            entry: {
              type: 'message',
              id: first,
              role: 'assistant',
              runId: run.id,
              text: 'Hello',
              occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            },
            messages: [Message.assistant('Hello')],
          },
        };
        yield* report(world, reports.recorded(run, [said], 'stdout:1'));
        expect(shown()).toEqual([[second, 'World']]);
        yield* report(world, reports.ended(run, { kind: 'completed' }));
        expect(shown()).toEqual([]);
      }),
    );
    test(
      'refreshing other open parts preserves a titled input and only sends its new characters',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER, {
          display: () => ({
            form: 'none',
            title: 'a.ts',
            alone: undefined,
            subtitle: undefined,
            reference: undefined,
            awaitsMs: undefined,
          }),
        });
        const inputId = hostedToolEntryId(run.id, 'call-1');
        const changes: ThreadOpenChange[] = [];
        world.feed.subscribe(run.threadId, (event) => {
          if (event.type !== 'open') return;
          const change = event.change;
          if ((change.op === 'put' ? change.entry.id : 'id' in change ? change.id : null) === inputId) changes.push(change);
        });
        yield* reports.live(run, { op: 'tool-input', callId: 'call-1', name: 'read', text: '{"path":"a.ts","rest":' });
        yield* reports.live(run, { op: 'append', stream: 'message', part: 0, text: 'One moment.' });
        yield* reports.live(run, { op: 'tool-input', callId: 'call-1', name: 'read', text: '1' });
        expect(changes.map((change) => change.op)).toEqual(['put', 'append']);
        expect(changes[1]).toEqual({ op: 'append', id: inputId, text: '1' });
        expect(world.feed.view(run.threadId).open.find((entry) => entry.id === inputId)).toMatchObject({
          toolDisplay: { form: 'none', title: 'a.ts' },
          toolInputRaw: { text: '{"path":"a.ts","rest":1' },
        });
      }),
    );
    test(
      'a retry writes the record of the request in work and closes the input the model was writing with the retry as its cause',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        yield* reports.live(run, { op: 'tool-input', callId: 'call-1', name: 'read', text: '{"path":"a' });
        expect(world.feed.view(run.threadId).open).toMatchObject([{ toolCallId: 'call-1', toolState: 'input-streaming' }]);
        const retry = { attempt: 1, of: 10, family: 'overloaded', delayMs: 500, status: 529, message: 'overloaded' } as const;
        yield* reports.live(run, { op: 'retry' });
        expect((yield* report(world, reports.retried(run, retry, 'retried:u1'))).status).toBe('applied');
        const usage = Usage.from({ inputTokens: 5, outputTokens: 2, totalTokens: 7 });
        expect((yield* report(world, reports.measured(run, { usage, attempt: 1 }, 'measured:m1'))).status).toBe('applied');
        expect((yield* report(world, reports.measured(run, { usage, attempt: 1 }, 'measured:m1'))).status).toBe('replayed');
        expect((yield* report(world, reports.retried(run, retry, 'retried:u1'))).status).toBe('replayed');
        expect((yield* world.runs.runById(run.id))?.usage).toMatchObject({ inputTokens: 5, outputTokens: 2 });
        expect(yield* entriesOf(world, run)).toMatchObject([
          { type: 'retry', id: retryEntryId(run.id, 0, 1), stepNumber: 0, attempt: 1, family: 'overloaded' },
          {
            type: 'tool',
            toolCallId: 'call-1',
            toolState: 'input-interrupted',
            toolInputRaw: { kind: 'text', text: '{"path":"a', complete: false },
            interruption: { stepNumber: 0, attempt: 1, cause: { family: 'overloaded', status: 529 } },
          },
        ]);
        expect(world.feed.view(run.threadId).open).toEqual([]);
      }),
    );
    test(
      'an end lands the text and the input still open in the tail, the input as interrupted',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        yield* reports.live(run, { op: 'append', stream: 'message', part: 0, text: 'Half of the ans' });
        yield* reports.live(run, { op: 'tool-input', callId: 'call-2', name: 'read', text: '{"pa' });
        yield* report(world, reports.ended(run, { kind: 'failed', reason: 'the agent died' }));
        expect((yield* entriesOf(world, run)).filter((entry) => entry.type === 'message' || entry.type === 'tool')).toMatchObject([
          { type: 'message', id: assistantMessageEntryId(run.id, 0), text: 'Half of the ans' },
          { type: 'tool', toolCallId: 'call-2', toolState: 'input-interrupted', toolInputRaw: { text: '{"pa' } },
        ]);
      }),
    );
    test(
      'an entry outside any run is journaled once per evidence, and a step to an ended run writes nothing',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const echo = [threadUserMessageEvent({ id: run.id }, { text: 'a boundary', reader: false })];
        const kinds = () =>
          Effect.map(readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 1_000), (events) =>
            events.map((event) => event.kind),
          );
        expect((yield* report(world, reports.outside(run.threadId, echo, 'stdout:1'))).status).toBe('applied');
        expect((yield* report(world, reports.outside(run.threadId, echo, 'stdout:1'))).status).toBe('replayed');
        yield* report(world, reports.ended(run, { kind: 'completed' }));
        expect((yield* report(world, reports.recorded(run, echo, 'stdout:2'))).status).toBe('settled');
        expect(yield* kinds()).toEqual(['message', 'run-end']);
      }),
    );
    test(
      'words the agent never confirmed enter the run that handed them, marked, and a later read only clears the mark; they stay out of what the run handled',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const first = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const steer = {
          ...(yield* wordsFor(first.threadId, 'steer-1')),
          kind: 'signal',
          body: { type: 'steer', addressee: 'transport', text: 'use the other table' },
        } as const;
        yield* world.storage.inbox.put(steer);
        yield* world.storage.inbox.deliver([steer.id], first.id);
        yield* report(world, reports.fate(first, 'unconfirmed', [steer.id]));
        expect(yield* world.storage.inbox.unconfirmed(first.threadId, first.id)).toEqual([steer.id]);
        expect(yield* signalsOf(world, first.threadId)).toEqual([{ runId: first.id, unconfirmed: true, said: true }]);
        yield* report(world, reports.ended(first, { kind: 'completed' }));
        const second = yield* opened(world);
        yield* report(world, reports.fate(second, 'read', [steer.id]));
        expect(yield* world.storage.inbox.unconfirmed(first.threadId, first.id)).toEqual([]);
        expect((yield* world.storage.inbox.pending(first.threadId)).map((item) => item.id)).toEqual([]);
        expect((yield* signalsOf(world, first.threadId)).at(-1)).toEqual({ runId: first.id, unconfirmed: undefined, said: false });
      }),
    );
    test(
      'words whose read deadline lapsed close once and stay marked unconfirmed through a later read',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const steer = {
          ...(yield* wordsFor(run.threadId, 'steer-lapsed')),
          kind: 'signal',
          body: { type: 'steer', addressee: 'transport', text: 'use the other table' },
        } as const;
        yield* world.storage.inbox.put(steer);
        yield* world.storage.inbox.deliver([steer.id], run.id);
        yield* report(world, reports.fate(run, 'unconfirmed', [steer.id]));
        expect(yield* world.storage.inbox.unconfirmed(run.threadId, run.id)).toEqual([steer.id]);
        expect((yield* report(world, reports.lapsed(run, [steer.id]))).status).toBe('applied');
        expect(yield* world.storage.inbox.unconfirmed(run.threadId, run.id)).toEqual([]);
        expect((yield* world.storage.inbox.pending(run.threadId)).map((item) => item.id)).toEqual([]);
        expect((yield* report(world, reports.lapsed(run, [steer.id]))).status).toBe('settled');
        yield* report(world, reports.fate(run, 'read', [steer.id]));
        expect(yield* signalsOf(world, run.threadId)).toEqual([{ runId: run.id, unconfirmed: true, said: true }]);
      }),
    );
    test(
      'withdrawing unconfirmed task and interrupt turns keeps delivered words without a reporting obligation',
      Effect.fnUntraced(function* () {
        for (const intent of ['task', 'interrupt'] as const) {
          const world = yield* lifecycleWorld(open);
          const run = yield* opened(world);
          const reports = world.reports.of(ADAPTER);
          const requester = yield* world.storage.createThread({ ownerId: 'owner', scope: SCOPE });
          const request = {
            ...(yield* wordsFor(run.threadId, 'request-unconfirmed')),
            kind: 'task',
            sender: { kind: 'thread', threadId: requester.id, name: 'asker' },
            body: { intent, text: 'rebuild the index', inReplyTo: null },
          } as const;
          yield* world.storage.inbox.put(request);
          yield* world.storage.inbox.deliver([request.id], run.id);
          const task = threadSignalOfInboxItem({ ...request, state: 'delivered', deliveredToRunId: run.id });
          yield* report(world, reports.recorded(run, [threadSignalOpening(task, run.id, request.body.text)], 'stdout:1'));
          yield* report(world, reports.fate(run, 'unconfirmed', [request.id]));
          if (intent === 'task') yield* world.storage.inbox.closeRequests([request.id], THREAD_REQUEST_DETACHED);
          expect(yield* world.storage.inbox.openRequests(run.threadId)).toEqual([]);
          const history = (yield* world.storage.aggregate.find(run.threadId))!.history;
          yield* world.lifecycle.stop(run, { by: 'reader', marker: false, withdraw: true }, false);
          expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'aborted' });
          expect((yield* world.storage.aggregate.find(run.threadId))!.history).toEqual(history);
          expect(yield* world.storage.inbox.receipt(request.id)).toMatchObject({ state: 'delivered', deliveredToRunId: run.id });
        }
      }),
    );
    test(
      'a request whose words lapsed unread reports once to its sender, closes once, and withdraws a run that only carries them',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const requester = yield* world.storage.createThread({ ownerId: 'owner', scope: SCOPE });
        const request = {
          ...(yield* wordsFor(run.threadId, 'request-lapsed')),
          kind: 'task',
          sender: { kind: 'thread', threadId: requester.id, name: 'asker' },
          body: { intent: 'task', text: 'rebuild the index', inReplyTo: null },
        } as const;
        yield* world.storage.inbox.put(request);
        yield* world.storage.inbox.deliver([request.id], run.id);
        const task = threadSignalOfInboxItem({ ...request, state: 'delivered', deliveredToRunId: run.id });
        yield* report(world, reports.recorded(run, [threadSignalOpening(task, run.id, request.body.text)], 'stdout:1'));
        expect((yield* report(world, reports.lapsed(run, [request.id]))).status).toBe('applied');
        const sent = (yield* world.storage.inbox.pending(requester.id)).filter((item) => item.kind === 'envelope');
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ id: unreadReportEnvelope(request.id), body: { intent: 'report', inReplyTo: request.id } });
        expect((yield* world.storage.inbox.pendingWakes(10)).map((item) => item.id)).toEqual([unreadReportEnvelope(request.id)]);
        expect((yield* world.storage.inbox.openRequests(run.threadId)).map((request) => request.id)).toEqual([]);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'withdrawn' });
        expect((yield* world.storage.aggregate.find(run.threadId))!.history).toEqual([]);
        expect((yield* report(world, reports.lapsed(run, [request.id]))).status).toBe('settled');
        expect((yield* world.storage.inbox.pending(requester.id)).filter((item) => item.kind === 'envelope')).toHaveLength(1);
        expect(yield* world.storage.inbox.pendingWakes(10)).toHaveLength(1);
        const signals = yield* signalsOf(world, run.threadId);
        yield* report(world, reports.fate(run, 'read', [request.id]));
        expect(yield* signalsOf(world, run.threadId)).toEqual(signals);
      }),
    );
    test(
      'words that lapsed on a run with other records leave that run alive',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const request = {
          ...(yield* wordsFor(run.threadId, 'request-busy')),
          kind: 'task',
          body: { intent: 'task', text: 'also this', inReplyTo: null },
        } as const;
        yield* world.storage.inbox.put(request);
        yield* world.storage.inbox.deliver([request.id], run.id);
        yield* report(
          world,
          reports.recorded(
            run,
            [
              threadUserMessageEvent({ id: run.id }, { text: 'also this', reader: false }),
              ownedByRun(
                threadSpokenToolEvent(
                  { toolName: 'bash', toolCallId: 'call-busy', input: {}, modelOutput: { type: 'text', value: 'ok' }, output: 'ok' },
                  new Date(yield* Clock.currentTimeMillis).toISOString(),
                ),
                run.id,
              ),
            ],
            'stdout:1',
          ),
        );
        yield* report(world, reports.fate(run, 'unconfirmed', [request.id]));
        expect((yield* report(world, reports.lapsed(run, [request.id]))).status).toBe('applied');
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running' });
      }),
    );
    test(
      'a lapse that turns back leaves the report, the closure, the withdrawal and the wake intent unwritten, and a retry carries them all',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const requester = yield* world.storage.createThread({ ownerId: 'owner', scope: SCOPE });
        const request = {
          ...(yield* wordsFor(run.threadId, 'request-turned-back')),
          kind: 'task',
          sender: { kind: 'thread', threadId: requester.id, name: 'asker' },
          body: { intent: 'task', text: 'rebuild the index', inReplyTo: null },
        } as const;
        yield* world.storage.inbox.put(request);
        yield* world.storage.inbox.deliver([request.id], run.id);
        yield* report(
          world,
          reports.recorded(run, [threadUserMessageEvent({ id: run.id }, { text: 'rebuild the index', reader: false })], 'stdout:1'),
        );
        yield* report(world, reports.fate(run, 'unconfirmed', [request.id]));
        const failed = yield* Effect.flip(
          world.storage.aggregate.transaction((unit) =>
            Effect.andThen(reports.lapsed(run, [request.id]).run(unit as ThreadWriteTx), Effect.fail('turned back' as const)),
          ),
        );
        expect(failed).toBe('turned back');
        expect(yield* world.storage.inbox.receipt(unreadReportEnvelope(request.id))).toBeUndefined();
        expect(yield* world.storage.inbox.pendingWakes(10)).toEqual([]);
        expect((yield* world.storage.inbox.openRequests(run.threadId)).map((request) => request.id)).toEqual([request.id]);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running' });
        expect((yield* report(world, reports.lapsed(run, [request.id]))).status).toBe('applied');
        expect((yield* world.storage.inbox.pendingWakes(10)).map((item) => item.id)).toEqual([unreadReportEnvelope(request.id)]);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'withdrawn' });
      }),
    );
    test(
      'a step and the end of a run in one write commit together and turn back together',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        const words = [threadUserMessageEvent({ id: run.id }, { text: 'tail', reader: false })];
        const both = Effect.fnUntraced(function* (unit: unknown) {
          yield* reports.recorded(run, words, 'stdout:1').run(unit as ThreadWriteTx);
          yield* reports.ended(run, { kind: 'completed' }).run(unit as ThreadWriteTx);
        });
        const kinds = () =>
          Effect.map(readThreadEvents(world.storage.eventLog, world.storage.kinds, run.threadId, 0, 1_000), (events) =>
            events.map((event) => event.kind),
          );
        world.control.drive(run);
        expect(world.control.size()).toBe(1);
        const failed = yield* Effect.flip(
          world.storage.aggregate.transaction((unit) => Effect.andThen(both(unit), Effect.fail('turned back' as const))),
        );
        expect(failed).toBe('turned back');
        expect(yield* kinds()).toEqual([]);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'running' });
        expect(world.control.size()).toBe(1);
        yield* world.storage.aggregate.transaction(both);
        expect(yield* kinds()).toEqual(['message', 'run-end']);
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'completed' });
        yield* until(() => Effect.sync(() => world.control.size() === 0));
      }),
    );
    test(
      'a plan names the tables it writes',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        const reports = world.reports.of(ADAPTER);
        expect(reports.recorded(run, [], 'stdout:1').tables).toContain('events');
        expect(reports.ended(run, { kind: 'completed' }).tables).toEqual(expect.arrayContaining(['runs', 'inbox', 'outbox']));
      }),
    );
    test(
      'an opening hands its run to the adapter only after the commit and the publication, keeps the run held meanwhile, and never from a unit that turns back',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const thread = (yield* world.storage.aggregate.find(world.startFrom.id))!;
        const published = yield* Deferred.make<void>();
        const opening = Effect.fnUntraced(function* (unit: unknown) {
          const start = started(yield* world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn', tx: unit as ThreadWriteTx }));
          yield* (unit as ThreadWriteTx).afterCommit(world.handover.begin(launchOf(thread, start.run), Deferred.await(published)));
          return start.run;
        });
        const failed = yield* Effect.flip(
          world.storage.aggregate.transaction((unit) => Effect.andThen(opening(unit), Effect.fail('turned back' as const))),
        );
        expect(failed).toBe('turned back');
        expect(world.adapter.launches).toEqual([]);
        const run = yield* world.storage.aggregate.transaction(opening);
        expect(world.adapter.launches).toEqual([]);
        expect(world.control.holds(run.id)).toBe(true);
        yield* Deferred.succeed(published, undefined);
        yield* until(() => Effect.sync(() => world.adapter.launches.length > 0));
        expect(world.adapter.launches.map((launch) => launch.run.id)).toEqual([run.id]);
        expect(world.adapter.transport.runs.holds([run.id])).toEqual([run.id]);
      }),
    );
    test(
      'a refused launch ends the run and returns its words; two in a row block the thread, a word lifts the block, and only a first step clears the count',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const thread = (yield* world.storage.aggregate.find(world.startFrom.id))!;
        const refuse = Effect.fnUntraced(function* () {
          const run = yield* opened(world);
          yield* world.storage.inbox.put(yield* wordsFor(thread.id, `words-${run.id}`));
          yield* world.storage.inbox.deliver([`words-${run.id}`], run.id);
          const before = world.published.length;
          yield* world.handover.begin(launchOf(thread, run), Effect.void);
          yield* world.settled(before + 1);
          return run;
        });
        world.adapter.refusing = true;
        const first = yield* refuse();
        expect(yield* world.runs.runById(first.id)).toMatchObject({ status: 'failed' });
        expect((yield* world.runs.runById(first.id))?.failureReason).toContain('the CLI is unreachable');
        expect((yield* world.storage.inbox.pending(thread.id)).map((item) => [item.id, item.state])).toEqual([
          [`words-${first.id}`, 'queued'],
        ]);
        expect(world.gate.blocked(thread.id)).toBe(false);
        yield* refuse();
        expect(world.gate.blocked(thread.id)).toBe(true);
        world.gate.lift(thread.id);
        yield* refuse();
        world.adapter.refusing = false;
        const going = yield* opened(world);
        yield* world.handover.begin(launchOf(thread, going), Effect.void);
        yield* world.lifecycle.finish(going, { kind: 'completed' });
        world.adapter.refusing = true;
        yield* refuse();
        expect(world.gate.blocked(thread.id)).toBe(true);
        world.gate.lift(thread.id);
        const confirmed = yield* opened(world);
        yield* report(world, world.reports.of(ADAPTER).recorded(confirmed, [], 'stdout:1'));
        yield* report(world, world.reports.of(ADAPTER).ended(confirmed, { kind: 'completed' }));
        yield* refuse();
        expect(world.gate.blocked(thread.id)).toBe(false);
      }),
    );
    test(
      'an adapter that reports a launch failure after the fact returns the words and counts the refusal',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        yield* world.storage.inbox.put(yield* wordsFor(run.threadId, 'words-1'));
        yield* world.storage.inbox.deliver(['words-1'], run.id);
        const refusedLaunch = Effect.fnUntraced(function* (failed: ThreadRunRow) {
          yield* report(world, world.reports.of(ADAPTER).refused(failed));
          yield* report(world, world.reports.of(ADAPTER).ended(failed, { kind: 'failed', reason: 'no pty', launch: true }));
        });
        yield* refusedLaunch(run);
        yield* refusedLaunch(yield* opened(world));
        expect((yield* world.storage.inbox.pending(run.threadId)).map((item) => item.state)).toEqual(['queued']);
        expect(world.gate.blocked(run.threadId)).toBe(true);
      }),
    );
    test(
      'one lasting launch refusal blocks the follow-up wake at once',
      Effect.fnUntraced(function* () {
        const world = yield* lifecycleWorld(open);
        const run = yield* opened(world);
        yield* report(world, world.reports.of(ADAPTER).refused(run, true));
        yield* report(world, world.reports.of(ADAPTER).ended(run, { kind: 'failed', reason: 'unknown-account', launch: true }));
        expect(yield* world.runs.runById(run.id)).toMatchObject({ status: 'failed' });
        expect(world.gate.blocked(run.threadId)).toBe(true);
      }),
    );
  });
}
const fakeRuns = Effect.fnUntraced(function* <TTx, TWrite extends TTx, R>(open: ThreadStorageFactory<TTx, TWrite, R>) {
  const world = yield* lifecycleWorld(open);
  const thread = (yield* world.storage.aggregate.find(world.startFrom.id))!;
  return {
    transport: world.adapter.transport,
    start: Effect.fnUntraced(function* () {
      const run = yield* opened(world);
      yield* world.handover.begin(launchOf(thread, run), Effect.void);
      yield* until(() => Effect.sync(() => world.adapter.launches.length > 0));
      return { thread, run };
    }),
    sent: () => world.adapter.launches.length,
  } satisfies RunsHarness;
});
function ownedByRun(event: ThreadEventBody, runId: string): ThreadEventBody {
  const payload = event.payload as {
    readonly entry: object;
  };
  return { ...event, payload: { ...payload, entry: { ...payload.entry, runId } } } as ThreadEventBody;
}
const wordsFor = Effect.fnUntraced(function* (threadId: string, id: string) {
  return {
    id,
    threadId,
    sender: { kind: 'reader' },
    kind: 'turn',
    body: { text: 'and check the second file too' },
    occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  } as const;
});
export function launchOf(thread: RunLaunch['thread'], run: RunLaunch['run']): RunLaunch {
  return { thread, run, oriented: true, outputOptional: false, seed: [], guidance: silentGuidance };
}
export const opened = <TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>) =>
  Effect.map(world.lifecycle.create(world.startFrom, APPROVAL, { kind: 'turn' }), (start) => started(start).run);
function attempt<TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>, plan: ReportPlan) {
  return world.storage.aggregate.transaction((unit) => plan.run(unit as ThreadWriteTx));
}
export function report<TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>, plan: ReportPlan) {
  return attempt(world, plan);
}
const entriesOf = <TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>, run: ThreadRunRef) =>
  Effect.map(world.storage.aggregate.entriesOfRun(run.threadId, run.id), (entries) => entries.filter(coreEntry));
const signalsOf = <TTx, TWrite extends TTx>(world: LifecycleWorld<TTx, TWrite>, threadId: string) =>
  Effect.map(readThreadEvents(world.storage.eventLog, world.storage.kinds, threadId, 0, 1_000), (events) =>
    events.flatMap((event) => {
      const entry = event.payload.entry;
      return entry !== undefined && entryOf('signal')(entry)
        ? [{ runId: entry.runId, unconfirmed: entry.unconfirmed, said: (event.payload.messages?.length ?? 0) > 0 }]
        : [];
    }),
  );
