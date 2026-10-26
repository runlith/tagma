import { describe, expect } from 'bun:test';
import type { Tester } from '@runlith/effect-test';
import { Clock, Effect, type Scope } from 'effect';
import { Message } from '@runlith/llm/schema/messages';
import { threadUserMessageEvent } from '../events';
import type { ReportPlan } from '../run/lifecycle/RunReports';
import { unreadReportEnvelope } from '../run/lifecycle/RunReports';
import type { ThreadWriteTx } from '../ThreadPorts';
import type { Transport } from '../transport/contract';
import { replyTurn, scriptedStep } from './runLog/scripts';
import { until } from './runLog/support';
import { openedRun, OWNER, SCOPE, scriptedWorld } from './runLog/world';
import type { ThreadStorageFactory } from './storagePort';
const ADAPTER = 'acp';
const RUN = 'turn-unread';
const idleAdapter: Transport = {
  adapter: ADAPTER,
  declares: { history: 'none', compaction: 'none' },
  words: 'opening',
  runs: {
    launch: () => Effect.void,
    deliver: () => Effect.void,
    withdraw: () => Effect.succeed('unsent'),
    queued: () => Effect.void,
    holds: () => [],
    interrupt: () => Effect.succeed('no-turn'),
    adopt: () => Effect.succeed('declined'),
    reached: () => Effect.void,
  },
};
function noted(text: string) {
  return replyTurn({
    chunks: [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text },
      { type: 'text-end', id: 't1' },
    ],
    steps: [scriptedStep({ text, messages: [Message.assistant(text)] })],
  });
}
export function describeUnreadWords<TTx, TWrite extends TTx = TTx, R = never>(
  name: string,
  open: ThreadStorageFactory<TTx, TWrite, R>,
  test: Tester<Scope.Scope | R>,
): void {
  describe(`${name}: words that lapsed unread report to their sender`, () => {
    test(
      'a lapsed request reports once and its saved delivery decides whether the sender wakes',
      Effect.fnUntraced(function* () {
        const { storage, thread, world } = yield* openedRun(open, { harness: { ownerId: OWNER } });
        yield* storage.aggregate.update(thread.id, { transport: { adapter: ADAPTER, profile: 'devin', agent: null } });
        yield* world.harness.runs.transports().register(idleAdapter);
        const requester = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        const collector = yield* storage.createThread({ ownerId: OWNER, scope: SCOPE });
        world.plan.push(noted('Understood.'));
        yield* storage.runs({ ownerId: OWNER, scope: SCOPE }).createRun({
          startFrom: {
            id: thread.id,
            ownerId: thread.ownerId,
            account: thread.account,
            provider: ADAPTER,
            model: null,
            reasoning: null,
            switches: {},
          },
          kind: 'turn',
          approval: { mode: 'trust', interactive: false },
          progress: { stage: null, message: null },
          runId: RUN,
        });
        const run = { id: RUN, threadId: thread.id };
        const request = {
          id: 'request-unread',
          threadId: thread.id,
          sender: { kind: 'thread', threadId: requester.id, name: 'asker' },
          kind: 'task',
          body: { intent: 'task', text: 'rebuild the index', inReplyTo: null },
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        } as const;
        const collected = {
          ...request,
          id: 'request-collected',
          sender: { ...request.sender, threadId: collector.id },
          body: { ...request.body, reportDelivery: 'collect' },
        } as const;
        yield* storage.inbox.put(request);
        yield* storage.inbox.put(collected);
        yield* storage.inbox.deliver([request.id, collected.id], RUN);
        const apply = (plan: ReportPlan) => storage.aggregate.transaction((unit) => plan.run(unit as unknown as ThreadWriteTx));
        const reports = world.harness.runs.reports().of(ADAPTER);
        yield* apply(
          reports.recorded(run, [threadUserMessageEvent({ id: RUN }, { text: 'rebuild the index', reader: false })], 'stdout:1'),
        );
        const requests = [request.id, collected.id];
        yield* apply(reports.fate(run, 'unconfirmed', requests));
        yield* apply(reports.lapsed(run, requests));
        const report = unreadReportEnvelope(request.id);
        yield* until(() => Effect.map(storage.inbox.pendingWakes(10), (pending) => pending.length === 0));
        const opened = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(requester.id);
        expect(opened).not.toBeNull();
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(collector.id)).toBeNull();
        expect((yield* storage.inbox.arrivals({ threadId: collector.id, after: null, reports: 'all' })).items).toMatchObject([
          { id: unreadReportEnvelope(collected.id), state: 'acknowledged', deliveredToRunId: null },
        ]);
        expect((yield* storage.inbox.receipt(report))?.state).not.toBe('queued');
        expect((yield* storage.inbox.openRequests(thread.id)).map((each) => each.id)).toEqual([]);
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).runById(RUN)).toMatchObject({ status: 'withdrawn' });
        expect(yield* apply(reports.lapsed(run, [request.id]))).toMatchObject({ status: 'settled' });
        expect(yield* storage.inbox.pendingWakes(10)).toEqual([]);
        expect((yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(requester.id))?.id).toBe(opened!.id);

        const finalRequest = { ...collected, id: 'request-collected-final' };
        yield* storage.inbox.put(finalRequest);
        yield* storage.inbox.deliver([finalRequest.id], RUN);
        const final = { to: [collector.id], intent: 'message', text: 'Collected final', key: 'collected-final', final: true } as const;
        const sent = yield* world.harness.collaboration.collaborate(thread.id, OWNER, (verbs) => verbs.messaging.send(final));
        expect(sent).toMatchObject({ status: 'sent', deliveries: [{ status: 'stored', runId: null }] });
        const settled = yield* world.harness.collaboration.collaborate(thread.id, OWNER, (verbs) => verbs.messaging.settle(final));
        expect(settled).toMatchObject({
          status: 'completed',
          output: { status: 'sent', deliveries: [{ status: 'stored', runId: null, closed: [finalRequest.id] }] },
        });
        expect(yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(collector.id)).toBeNull();
      }),
    );
    test(
      'a wake intent committed before the server could act on it is carried out by the next start',
      Effect.fnUntraced(function* () {
        const stack = yield* openedRun(open, { harness: { ownerId: OWNER } });
        const { storage, thread } = stack;
        const report = {
          id: 'envelope:report:request-crash:unread',
          threadId: thread.id,
          sender: { kind: 'host' },
          kind: 'envelope',
          body: { intent: 'report', text: 'Your words were never read.', inReplyTo: 'request-crash' },
          occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        } as const;
        yield* storage.inbox.put(report);
        yield* storage.inbox.intendWake([report.id]);
        yield* stack.world.dispose();
        expect((yield* storage.inbox.pendingWakes(10)).map((each) => each.id)).toEqual([report.id]);
        const restarted = yield* scriptedWorld(storage, thread.agentId, { harness: { ownerId: OWNER } });
        restarted.plan.push(noted('Understood.'));
        yield* until(() => Effect.map(storage.inbox.pendingWakes(10), (pending) => pending.length === 0));
        const opened = yield* storage.runs({ ownerId: 'observer', scope: SCOPE }).latestRun(thread.id);
        expect(opened).not.toBeNull();
        expect((yield* storage.inbox.receipt(report.id))?.state).not.toBe('queued');
      }),
    );
  });
}
