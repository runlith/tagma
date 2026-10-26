import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadSignalInput } from '@runlith/agent/thread/run/scheduler/inputs';
import type { ThreadInboxItem } from '@runlith/agent/thread/storage/inbox';
import { OPERATOR_PRINCIPAL } from '../../platform/contract/wire/actor.js';
import type { AgentToolOutputInput } from '@runlith/agent/ToolOutput';
import type { HarnessToolOutputs, NativeStorage } from '../contract/service/engine.js';
import type { ThreadList } from '../contract/service/list.js';
import { makeThreadEvents } from '../events/happened.js';
import { makeOpener, type Opener } from '../events/opener.js';
import type { EventReads } from '../events/reads.js';
import type { ThreadInbox } from '../store/inbox.js';
import { makeEventLines } from '../subscriptions/delivery.js';
import { makeChildUpdates, type ChildUpdatesInput } from './childUpdates.js';

const unbounded = {
  scope: () => ({ project: (input: AgentToolOutputInput) => Effect.succeed({ output: input.output, modelOutput: input.modelOutput }) }),
} as unknown as HarnessToolOutputs['Service'];

const EXPIRES = 5 * 60_000;
const HELD = 150_000;

const child = {
  id: 'child',
  name: 'seam',
  parentThreadId: 'lead',
  ownerId: OPERATOR_PRINCIPAL,
  archivedAt: null,
  activeRun: null,
  outcome: { runId: 'run-1' },
  contextReading: { runId: 'run-1', measuredAt: new Date(0).toISOString() },
};

const ended: ThreadRunSettled = {
  runId: 'run-1',
  threadId: child.id,
  kind: 'turn',
  status: 'completed',
  failureReason: null,
  failure: null,
  stoppedBy: null,
};

const warmthAt = (now: number): ThreadCacheWarmth => ({
  state: now < EXPIRES ? 'warm' : 'cold',
  heldTokens: HELD,
  basis: 'promise',
  expiresAt: new Date(EXPIRES).toISOString(),
  gap: null,
  warmShare: null,
  sample: null,
  oldestAt: null,
  invalidatedBy: null,
});

function world(handed: readonly ThreadInboxItem[] = [], reported = false) {
  const parentInbox: ThreadInboxItem[] = [];
  const behaviors: unknown[] = [];
  const summaries = new Map<string, unknown>([
    [child.id, child],
    ['lead', { id: 'lead', archivedAt: null }],
  ]);
  const handle = {
    sendSignal: (signal: ThreadSignalInput, behavior: unknown) =>
      Effect.sync(() => {
        behaviors.push(behavior);
        if (parentInbox.some((item) => item.id === signal.id)) return { status: 'persisted' };
        parentInbox.push({
          id: signal.id!,
          threadId: 'lead',
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
      Effect.sync(() => {
        const at = parentInbox.findIndex((item) => item.id === id && item.state === 'queued');
        if (at >= 0) parentInbox.splice(at, 1);
        return at >= 0;
      }),
  };
  const inbox = {
    pending: () => Effect.succeed([...parentInbox]),
    delivered: () => Effect.succeed(handed.map((item) => item.id)),
    readerSpoke: () => Effect.succeed(handed.some((item) => item.sender.kind === 'reader')),
    receipt: (id: string) => Effect.succeed(handed.find((item) => item.id === id)),
  } as unknown as ThreadInbox['Service'];
  const storage = { threads: { entriesOfRun: () => Effect.succeed([]) } } as unknown as NativeStorage['Service'];
  const input = {
    threads: {
      summary: (id: string) => Effect.succeed(summaries.get(id)),
      summaries: (ids: readonly string[]) => Effect.succeed(ids.flatMap((id) => summaries.get(id) ?? [])),
    },
    storage,
    warmth: (_thread: unknown, now: number) => Effect.succeed(warmthAt(now)),
    reads: { reported: () => Effect.succeed(reported) },
    lines: makeEventLines({ inbox, outputs: unbounded, harness: () => ({ threads: { handle: () => handle } }) as never }),
  } as unknown as ChildUpdatesInput;
  const unread = () => parentInbox.map((item) => (item.kind === 'signal' ? item.body.text : ''));
  const told = () => parentInbox.map((item) => (item.kind === 'signal' ? item.body.notice : undefined));
  return { input: { ...input, opener: makeOpener({ inbox, storage }) }, unread, told, behaviors };
}

const makeChildEvents = (input: ChildUpdatesInput & { readonly opener: Opener }) =>
  Effect.flatMap(makeChildUpdates(input), ({ recipient }) =>
    Effect.map(
      makeThreadEvents({
        threads: input.threads,
        list: {} as ThreadList['Service'],
        states: () => () => undefined,
        warmth: input.warmth,
        reads: { cached: Effect.succeed([child.id]) } as unknown as EventReads,
        opener: input.opener,
        recipients: [recipient],
      }),
      (events) => ({ subscriber: events.subscribers[0]!, start: events.start, told: events.told }),
    ),
  );

it.effect('a child that ran and then cooled leaves its parent one unread line of its latest state, and restarts repeat none', () =>
  Effect.gen(function* () {
    const { input, unread, behaviors } = world();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const updates = yield* makeChildEvents(input);
        yield* updates.subscriber.handle(ended);
        yield* updates.subscriber.handle(ended);
        expect(unread()).toEqual(['seam ran · context 150k · warm until 00:05Z']);
      }),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const restarted = yield* makeChildEvents(input);
        yield* restarted.start();
        yield* TestClock.adjust('5 minutes');
        expect(unread()).toEqual(['seam cooled · 150k to rewrite']);
      }),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const again = yield* makeChildEvents(input);
        yield* again.start();
        yield* TestClock.adjust('1 hour');
      }),
    );
    yield* Effect.scoped(Effect.flatMap(makeChildEvents(input), (late) => late.subscriber.handle(ended)));
    expect(unread()).toEqual(['seam cooled · 150k to rewrite']);
    expect(behaviors).toHaveLength(3);
    expect(behaviors.every((behavior) => JSON.stringify(behavior) === JSON.stringify({ ifActive: 'deliver', ifIdle: 'wait' }))).toBe(true);
  }),
);

it.effect('unread selection changes and lifecycle updates replace only their own facts before the parent reads them', () =>
  Effect.gen(function* () {
    const { input, told } = world();
    const updates = yield* makeChildEvents(input);
    const from = { provider: 'first', model: 'one', reasoning: 'high' };
    const to = { provider: 'second', model: 'two', reasoning: 'xhigh' };
    yield* updates.told(child.id, { kind: 'model-changed', change: { id: 'choice-1', from, to } });
    yield* updates.subscriber.handle(ended);
    yield* TestClock.adjust('5 minutes');
    expect(told()).toMatchObject([{ event: 'model-changed', from, to }, { event: 'cooled' }]);
    const next = { ...to, reasoning: 'low' };
    yield* updates.told(child.id, { kind: 'model-changed', change: { id: 'choice-2', from: to, to: next } });
    expect(told()).toMatchObject([{ event: 'cooled' }, { event: 'model-changed', from: to, to: next }]);
  }),
);

it.effect('a run that reported to its parent gives no line of its own, and an operator’s run says so', () =>
  Effect.gen(function* () {
    const answered = world([], true);
    yield* Effect.scoped(Effect.flatMap(makeChildEvents(answered.input), (updates) => updates.subscriber.handle(ended)));
    expect(answered.unread()).toEqual([]);
    const turn: ThreadInboxItem = {
      id: 'turn-1',
      threadId: child.id,
      sender: { kind: 'reader' },
      kind: 'turn',
      body: { text: 'Look again.' },
      state: 'acknowledged',
      deliveredToRunId: 'run-1',
      occurredAt: new Date(0).toISOString(),
    };
    const spoken = world([turn]);
    yield* Effect.scoped(Effect.flatMap(makeChildEvents(spoken.input), (updates) => updates.subscriber.handle(ended)));
    expect(spoken.unread()).toEqual(['seam ran · context 150k · warm until 00:05Z · for the operator']);
    expect(spoken.told()).toMatchObject([
      {
        kind: 'child-update',
        child: { threadId: child.id, name: 'seam' },
        event: 'ran',
        forOperator: true,
        cost: { kind: 'warm', tokens: HELD, until: new Date(EXPIRES).toISOString() },
      },
    ]);
  }),
);
