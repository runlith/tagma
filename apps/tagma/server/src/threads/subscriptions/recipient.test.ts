import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import type { ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadSignalInput } from '@runlith/agent/thread/run/scheduler/inputs';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import type { AgentToolOutputInput } from '@runlith/agent/ToolOutput';
import type { HarnessToolOutputs } from '../contract/service/engine.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { EventReads } from '../events/reads.js';
import type { ThreadSubscriptions } from '../contract/service/subscriptions.js';
import type { ThreadSummary } from '../list/summary.js';
import type { ThreadInbox } from '../store/inbox.js';
import { makeEventLines } from './delivery.js';
import { makeSubscriptionRecipient } from './recipient.js';

const unbounded = {
  scope: () => ({ project: (input: AgentToolOutputInput) => Effect.succeed({ output: input.output, modelOutput: input.modelOutput }) }),
} as unknown as HarnessToolOutputs['Service'];

const row = (id: string) => ({ id, name: id, title: id, projectId: 1, archivedAt: null }) as unknown as ThreadSummary;

const run: ThreadRunSettled = {
  runId: 'run-1',
  threadId: 'lead',
  kind: 'turn',
  status: 'failed',
  failureReason: 'provider refused',
  failure: null,
  stoppedBy: null,
};

const fixture = (wakes: readonly string[], answered = false) => {
  const queue: ThreadInboxItem[] = [];
  const idle: unknown[] = [];
  const handle = {
    sendSignal: (signal: ThreadSignalInput, behavior: { readonly ifIdle?: string }) =>
      Effect.sync(() => {
        idle.push(behavior.ifIdle);
        queue.push({
          id: signal.id!,
          threadId: 'secretary',
          sender: { kind: 'host' },
          kind: 'signal',
          body: { type: signal.type!, addressee: 'transport', text: signal.text, notice: signal.notice },
          state: 'queued',
          deliveredToRunId: null,
          occurredAt: new Date(0).toISOString(),
        });
        return { status: 'persisted' };
      }),
    retractSignal: (id: string) =>
      Effect.sync(
        () =>
          queue.splice(
            queue.findIndex((item) => item.id === id),
            1,
          ).length > 0,
      ),
  };
  const lines = makeEventLines({
    inbox: {
      pending: () => Effect.sync(() => [...queue]),
      receipt: (id: string) => Effect.sync(() => queue.find((item) => item.id === id)),
    } as unknown as ThreadInbox['Service'],
    outputs: unbounded,
    harness: () => ({ threads: { handle: () => handle } }) as never,
  });
  const recipient = makeSubscriptionRecipient({
    subscriptions: {
      subscribersOf: () => Effect.succeed([{ subscriberId: 'secretary', targetId: 'lead', wakes, createdAt: new Date(0) }]),
    } as unknown as ThreadSubscriptions['Service'],
    threads: { summary: (id: string) => Effect.succeed(row(id)) } as unknown as ThreadLookup['Service'],
    lines,
    reads: { answered: () => Effect.succeed(answered) } as unknown as EventReads,
  });
  return { recipient, queue, idle };
};

it.effect('an idle subscriber wakes only for the kinds it asked, and unread events of one thread stand as one line', () =>
  Effect.gen(function* () {
    const { recipient, queue, idle } = fixture(['failed']);
    const lead = row('lead');
    yield* recipient.handle({ kind: 'rested', thread: lead, run: { ...run, status: 'completed' }, words: 'Done.', byOperator: false });
    yield* recipient.handle({ kind: 'failed', thread: lead, run });
    yield* recipient.handle({ kind: 'committed', thread: lead, commit: '743ba20b87aa', subject: 'Land it' });
    expect(idle).toEqual(['wait', 'wake', 'wait']);
    expect(queue.map((item) => (item.kind === 'signal' ? item.body.notice : null))).toEqual([
      {
        kind: 'thread-event',
        thread: { threadId: 'lead', projectId: 1, name: 'lead' },
        event: 'committed',
        wakes: false,
        forOperator: false,
      },
    ]);
  }),
);

it.effect('an operator-opened turn leaves its subscribed answer queued without waking the subscriber', () =>
  Effect.gen(function* () {
    const { recipient, queue, idle } = fixture(['rested']);
    yield* recipient.handle({
      kind: 'rested',
      thread: row('lead'),
      run: { ...run, status: 'completed' },
      words: 'The floor stands.',
      byOperator: true,
    });
    expect(idle).toEqual(['wait']);
    expect(queue).toMatchObject([
      {
        state: 'queued',
        deliveredToRunId: null,
        body: { notice: { kind: 'thread-event', event: 'rested', wakes: false, forOperator: true } },
      },
    ]);
    expect(queue.find((item) => item.kind === 'signal')?.body.text).toContain('The floor stands.');
  }),
);

it.effect('a rested line carries the whole long answer including a question between its paragraphs', () =>
  Effect.gen(function* () {
    const { recipient, queue, idle } = fixture(['rested']);
    const words = [
      'Each joint was measured twice against the drawing. '.repeat(12).trimEnd(),
      'Should the east wing take steel beams instead of oak?',
      'Its footings are poured and cured. '.repeat(12).trimEnd(),
    ].join('\n\n');
    yield* recipient.handle({ kind: 'rested', thread: row('lead'), run: { ...run, status: 'completed' }, words, byOperator: false });
    expect(idle).toEqual(['wake']);
    expect(queue.find((item) => item.kind === 'signal')?.body.text).toContain(words);
  }),
);

it.effect('a run that answered the subscriber by report neither repeats its words in the rested line nor wakes it again', () =>
  Effect.gen(function* () {
    const { recipient, queue, idle } = fixture(['rested'], true);
    const words = 'The walls stand plumb on every floor.';
    yield* recipient.handle({ kind: 'rested', thread: row('lead'), run: { ...run, status: 'completed' }, words, byOperator: false });
    expect(idle).toEqual(['wait']);
    expect(queue).toMatchObject([
      {
        state: 'queued',
        deliveredToRunId: null,
        body: { notice: { kind: 'thread-event', event: 'rested', wakes: false, forOperator: false } },
      },
    ]);
    expect(queue.find((item) => item.kind === 'signal')?.body.text).not.toContain(words);
  }),
);
