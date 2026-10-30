import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { AskRefused } from '../../providers/contract/service/asks.js';
import type { ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { AttentionEvent, ThreadList } from '../contract/service/list.js';
import type { ThreadDecisions } from '../contract/service/decisions.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadSummary } from '../list/summary.js';
import { makeThreadEvents, type ThreadEvent, type ThreadEventRecipient } from './happened.js';
import type { EventReads } from './reads.js';

const settled = (threadId: string, runId: string, over: Partial<ThreadRunSettled> = {}): ThreadRunSettled => ({
  runId,
  threadId,
  kind: 'turn',
  status: 'completed',
  failureReason: null,
  failure: null,
  stoppedBy: null,
  ...over,
});

const resting = (id: string, runId: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name: id,
    title: id,
    projectId: 1,
    parentThreadId: id === 'lead' ? null : 'lead',
    ownerId: 'operator',
    archivedAt: null,
    activeRun: null,
    outcome: { runId },
    ask: null,
    saidLine: `${id} is done`,
    ...over,
  }) as unknown as ThreadSummary;

type Verdict = 'yes' | 'no' | 'refused';

function world(following: readonly string[], verdict: Verdict = 'yes') {
  const rows = new Map<string, ThreadSummary>();
  const busy = new Set<string>();
  const attention = new Set<(event: AttentionEvent) => void>();
  const states = new Set<(state: NativeThreadState) => void>();
  const told: ThreadEvent[] = [];
  const recipient: ThreadEventRecipient = {
    name: 'watcher',
    takes: ['rested', 'failed', 'stalled', 'awaiting', 'addresses-human', 'stopped'],
    follows: (thread) => Effect.succeed(following.includes(thread.id)),
    handle: (event) => Effect.sync(() => void told.push(event)),
  };
  const threads = {
    summary: (id: string) => Effect.sync(() => rows.get(id)),
    summaries: (ids: readonly string[]) => Effect.sync(() => ids.flatMap((id) => rows.get(id) ?? [])),
  } as unknown as ThreadLookup['Service'];
  const list = {
    attention: () => Effect.succeed([]),
    subscribeAttention: (listener: (event: AttentionEvent) => void) => {
      attention.add(listener);
      return () => attention.delete(listener);
    },
  } as unknown as ThreadList['Service'];
  const reads = {
    cached: Effect.succeed([]),
    quiet: (id: string) => Effect.sync(() => !busy.has(id)),
    finalWords: () => Effect.succeed('Shall I merge it into main?'),
    lineage: (id: string) => Effect.succeed(id === 'lead' ? ['lead'] : [id, 'lead']),
  } as unknown as EventReads;
  const decisions = {
    decide: () =>
      verdict === 'refused'
        ? Effect.fail(new AskRefused({ refusal: 'ask-unanswerable', message: 'none' }))
        : Effect.succeed({ answers: { addresses: { type: 'noul', noul: verdict === 'yes', probability: null } } }),
  } as unknown as ThreadDecisions['Service'];
  const make = Effect.tap(
    makeThreadEvents({
      threads,
      list,
      states: (listener) => {
        states.add(listener);
        return () => states.delete(listener);
      },
      warmth: () => Effect.succeed(null),
      reads,
      opener: () => Effect.succeed(false),
      recipients: [recipient],
    }),
    (events) => Effect.sync(() => events.serveDecisions(decisions)),
  );
  return { rows, busy, told, make, attention, states, kinds: () => told.map((event) => `${event.thread.id}:${event.kind}`) };
}

it.effect('a lead whose children run does not rest; the ending after the last report rests it once', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lead = world(['lead'], 'no');
      const events = yield* lead.make;
      const end = (runId: string) => Effect.forEach(events.subscribers, (subscriber) => subscriber.handle(settled('lead', runId)));
      lead.busy.add('lead');
      lead.rows.set('lead', resting('lead', 'run-1'));
      yield* end('run-1');
      lead.rows.set('lead', resting('lead', 'run-2'));
      yield* end('run-2');
      lead.busy.delete('lead');
      lead.rows.set('lead', resting('lead', 'run-3'));
      yield* end('run-3');
      expect(lead.told.map((event) => (event.kind === 'rested' ? event.run.runId : event.kind))).toEqual(['run-3']);
    }),
  ),
);

it.effect('a failed child tells nothing to the watcher of its lead, a failed lead does', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lead = world(['lead']);
      const events = yield* lead.make;
      lead.rows.set('worker', resting('worker', 'run-1'));
      lead.rows.set('lead', resting('lead', 'run-2'));
      for (const subscriber of events.subscribers) {
        yield* subscriber.handle(settled('worker', 'run-1', { status: 'failed', failureReason: 'refused' }));
        yield* subscriber.handle(settled('lead', 'run-2', { status: 'failed', failureReason: 'refused' }));
      }
      expect(lead.kinds()).toEqual(['lead:failed']);
    }),
  ),
);

it.live("a lead's question for the operator awaits once; a question its parent answers does not", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lead = world(['lead', 'worker']);
      yield* lead.make;
      const asking = (id: string, approver?: string) =>
        resting(id, 'run-1', {
          outcome: null,
          activeRun: { id: 'run-1', startedAt: new Date(0) },
          ask: { questionId: 'q1', text: 'Push to origin?', kind: 'question', key: 'k', askedAt: null, options: [], approver },
        });
      for (const row of [asking('lead'), asking('lead'), asking('worker', 'lead')])
        lead.attention.forEach((listener) => listener({ kind: 'row', row: row as never }));
      yield* Effect.sleep('20 millis');
      expect(lead.told.map((event) => (event.kind === 'awaiting' ? [event.thread.id, event.eventId] : event.kind))).toEqual([
        ['lead', 'run-1:q1'],
      ]);
    }),
  ),
);

it.live('a stalled child is told to the watcher of its lead by name', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const lead = world(['lead']);
      yield* lead.make;
      lead.rows.set('lead', resting('lead', 'run-1'));
      lead.rows.set('worker', resting('worker', 'run-2'));
      const state = { thread: { id: 'worker', updatedAt: new Date(0) }, status: { life: 'stalled', runId: 'run-2' } };
      lead.states.forEach((listener) => listener(state as unknown as NativeThreadState));
      lead.states.forEach((listener) => listener(state as unknown as NativeThreadState));
      yield* Effect.sleep('20 millis');
      expect(lead.told.map((event) => (event.kind === 'stalled' ? [event.thread.id, event.stalled.name] : event.kind))).toEqual([
        ['lead', 'worker'],
      ]);
    }),
  ),
);

it.effect('a busy root whose last words ask a human is told only when the decision says yes', () =>
  Effect.scoped(
    Effect.gen(function* () {
      const answered: Record<Verdict, readonly string[]> = { yes: [], no: [], refused: [] };
      for (const verdict of ['yes', 'no', 'refused'] as const) {
        const root = world(['lead'], verdict);
        const events = yield* root.make;
        root.busy.add('lead');
        root.rows.set('lead', resting('lead', 'run-1'));
        for (const subscriber of events.subscribers) yield* subscriber.handle(settled('lead', 'run-1'));
        answered[verdict] = root.kinds();
      }
      expect(answered).toEqual({ yes: ['lead:addresses-human'], no: [], refused: [] });
    }),
  ),
);
