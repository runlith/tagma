import { Cause, Clock, Duration, Effect, Exit, FiberMap, FiberSet } from 'effect';
import type { DecisionRequest } from '@runlith/llm/decision';
import type { ThreadCacheWarmth } from '@runlith/agent/thread/cache/ThreadCacheWarmth';
import type { ThreadRunSettled } from '@runlith/agent/thread/run/ThreadRunLedger';
import type { ThreadRunSettledSubscriber } from '@runlith/agent/thread/run/ThreadRunSettlements';
import { type ThreadBorderFailed, ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadDecisions } from '../contract/service/decisions.js';
import type { ThreadFact } from '../contract/service/events.js';
import type { ThreadList } from '../contract/service/list.js';
import type { ThreadLookup } from '../contract/service/reads.js';
import type { NativeThreadState } from '../contract/service/state.js';
import type { ThreadAsk } from '../contract/wire/list.js';
import type { ThreadSummary } from '../list/summary.js';
import type { Opener } from './opener.js';
import type { EventReads } from './reads.js';
import { standingOf } from './standing.js';

export type PromisedWarmth = ThreadCacheWarmth & { readonly basis: 'promise'; readonly expiresAt: string };

type Of = { readonly thread: ThreadSummary };

export type SubscribedEvent =
  | (Of & { readonly kind: 'rested'; readonly run: ThreadRunSettled; readonly words: string | null; readonly byOperator: boolean })
  | (Of & { readonly kind: 'failed'; readonly run: ThreadRunSettled })
  | (Of & { readonly kind: 'stopped'; readonly run: ThreadRunSettled })
  | (Of & { readonly kind: 'addresses-human'; readonly run: ThreadRunSettled; readonly words: string })
  | (Of & {
      readonly kind: 'stalled';
      readonly stalled: { readonly id: string; readonly name: string | null; readonly runId: string; readonly since: string };
    })
  | (Of & { readonly kind: 'awaiting'; readonly eventId: string; readonly ask: ThreadAsk })
  | (Of & Extract<ThreadFact, { readonly kind: 'committed' | 'task-closed' }>);

export type ThreadEvent =
  | (Of & {
      readonly kind: 'ended';
      readonly run: ThreadRunSettled;
      readonly latest: boolean;
      readonly byOperator: Effect.Effect<boolean, ThreadBorderFailed>;
    })
  | (Of & { readonly kind: 'cooled'; readonly warmth: PromisedWarmth })
  | (Of & Extract<ThreadFact, { readonly kind: 'model-changed' }>)
  | SubscribedEvent;

export type ThreadEventRecipient = {
  readonly name: string;
  readonly takes: readonly ThreadEvent['kind'][];
  readonly follows: (thread: ThreadSummary) => Effect.Effect<boolean, ThreadBorderFailed>;
  readonly handle: (event: ThreadEvent) => Effect.Effect<void, ThreadBorderFailed>;
};

export type ThreadWarmth = (thread: ThreadSummary, now: number) => Effect.Effect<ThreadCacheWarmth | null, unknown>;

export type ThreadEventsInput = {
  readonly threads: ThreadLookup['Service'];
  readonly list: ThreadList['Service'];
  readonly states: (listener: (state: NativeThreadState) => void) => () => void;
  readonly warmth: ThreadWarmth;
  readonly reads: EventReads;
  readonly opener: Opener;
  readonly recipients: readonly ThreadEventRecipient[];
};

export const isPromised = (judged: ThreadCacheWarmth | null): judged is PromisedWarmth =>
  judged !== null && judged.basis === 'promise' && judged.expiresAt !== null;

const ADDRESSES = 'addresses';

const addressing = (words: string): DecisionRequest => ({
  state: words,
  instructions: "The text is the final message of an agent's turn; only a human reads it.",
  questions: {
    [ADDRESSES]: {
      type: 'noul',
      instructions: 'Does this text ask a human something, or wait for a human decision before the work goes on?',
    },
  },
});

const broke = (cause: unknown) => new ThreadCallBroke({ cause });

export const makeThreadEvents = Effect.fnUntraced(function* ({
  threads,
  list,
  states,
  warmth,
  reads,
  opener,
  recipients,
}: ThreadEventsInput) {
  const timers = yield* FiberMap.make<string>();
  const runFork = yield* FiberSet.makeRuntime<never, void, never>();
  const taking = (kind: ThreadEvent['kind']) => recipients.filter((recipient) => recipient.takes.includes(kind));
  const cooling = taking('cooled');
  let decisions: ThreadDecisions['Service'] | null = null;

  const fan = Effect.fnUntraced(function* (event: ThreadEvent) {
    for (const recipient of taking(event.kind)) {
      if (yield* recipient.follows(event.thread)) yield* recipient.handle(event);
    }
  });

  const watched = (work: Effect.Effect<void, unknown>, what: string) =>
    runFork(
      Effect.catchCause(work, (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning(`${what} could not be told to its recipients`, { reason: Cause.pretty(cause) }),
      ),
    );

  const promised = Effect.fnUntraced(function* (thread: ThreadSummary) {
    const judged = yield* warmth(thread, yield* Clock.currentTimeMillis);
    return isPromised(judged) ? judged : null;
  });

  const cooled = Effect.fnUntraced(function* (threadId: string, expiresAt: string) {
    const thread = yield* threads.summary(threadId);
    if (thread === undefined || thread.activeRun !== null) return;
    const following: ThreadEventRecipient[] = [];
    for (const recipient of cooling) if (yield* recipient.follows(thread)) following.push(recipient);
    if (following.length === 0) return;
    const judged = yield* promised(thread);
    if (judged === null || judged.expiresAt !== expiresAt || judged.state !== 'cold') return;
    for (const recipient of following) yield* recipient.handle({ kind: 'cooled', thread, warmth: judged });
  });

  const watch = Effect.fnUntraced(function* (thread: ThreadSummary) {
    const judged = thread.activeRun === null ? yield* promised(thread) : null;
    if (judged === null || judged.state !== 'warm') return yield* FiberMap.remove(timers, thread.id);
    const expiresAt = judged.expiresAt;
    const wait = Math.max(0, Date.parse(expiresAt) - (yield* Clock.currentTimeMillis));
    yield* FiberMap.run(
      timers,
      thread.id,
      Effect.sleep(Duration.millis(wait)).pipe(
        Effect.andThen(cooled(thread.id, expiresAt)),
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning('a thread that cooled could not be told to its recipients', {
                threadId: thread.id,
                reason: Cause.pretty(cause),
              }),
        ),
      ),
    );
  });

  const addressed = Effect.fnUntraced(function* (thread: ThreadSummary, run: ThreadRunSettled) {
    if (decisions === null) return yield* broke(new Error('no decision owner serves yet; the ending is told once one does'));
    const words = yield* reads.finalWords(thread.id, run.runId).pipe(Effect.mapError(broke));
    if (words === null || words.trim() === '') return null;
    const verdict = yield* decisions.decide(thread.id, addressing(words), { run: run.runId }).pipe(
      Effect.map((decision) => decision.answers[ADDRESSES] ?? null),
      Effect.catchTag('AskRefused', () => Effect.succeed(null)),
      Effect.mapError(broke),
    );
    if (verdict?.type !== 'noul' || !verdict.noul) return null;
    return { kind: 'addresses-human', thread, run, words } satisfies ThreadEvent;
  });

  const endedEvents = Effect.fnUntraced(function* (recipient: ThreadEventRecipient, thread: ThreadSummary, run: ThreadRunSettled) {
    const takes = (kind: ThreadEvent['kind']) => recipient.takes.includes(kind);
    const latest = thread.activeRun === null && thread.outcome?.runId === run.runId;
    let opened: boolean | undefined;
    const byOperator = Effect.suspend(() =>
      opened !== undefined || run.kind !== 'turn'
        ? Effect.succeed(opened ?? false)
        : opener(thread.id, run.runId).pipe(
            Effect.tap((found) => Effect.sync(() => (opened = found))),
            Effect.mapError(broke),
          ),
    );
    const events: ThreadEvent[] = [];
    if (takes('ended')) events.push({ kind: 'ended', thread, run, latest, byOperator });
    if (run.kind !== 'turn' || !latest) return events;
    if ((run.status === 'failed' || run.status === 'cut') && takes('failed')) events.push({ kind: 'failed', thread, run });
    if (run.stoppedBy === 'reader' && takes('stopped')) events.push({ kind: 'stopped', thread, run });
    if (run.status !== 'completed' || !(takes('rested') || takes('addresses-human'))) return events;
    if (yield* reads.quiet(thread.id).pipe(Effect.mapError(broke))) {
      if (takes('rested')) {
        const words = yield* reads.finalWords(thread.id, run.runId).pipe(Effect.mapError(broke));
        events.push({
          kind: 'rested',
          thread,
          run,
          words: words === null || words.trim() === '' ? null : words,
          byOperator: yield* byOperator,
        });
      }
    } else if (takes('addresses-human') && thread.parentThreadId === null && !(yield* byOperator)) {
      const human = yield* addressed(thread, run);
      if (human !== null) events.push(human);
    }
    return events;
  });

  const subscriberOf = (recipient: ThreadEventRecipient): ThreadRunSettledSubscriber => ({
    name: recipient.name,
    at: 'after-stages',
    handle: Effect.fn('ThreadEvents.settled')(function* (run: ThreadRunSettled) {
      const thread = yield* threads.summary(run.threadId).pipe(Effect.mapError(broke));
      if (thread === undefined || !(yield* recipient.follows(thread))) return;
      if (recipient.takes.includes('cooled')) yield* watch(thread).pipe(Effect.mapError(broke));
      for (const event of yield* endedEvents(recipient, thread, run)) yield* recipient.handle(event);
    }),
  });

  const awaited = new Map<string, string>();

  const standing = Effect.fnUntraced(function* (row: ThreadSummary) {
    const now = standingOf(row);
    if (now?.kind !== 'awaiting') return void awaited.delete(row.id);
    if (awaited.get(row.id) === now.eventId) return;
    awaited.set(row.id, now.eventId);
    yield* fan({ kind: 'awaiting', thread: row, eventId: now.eventId, ask: now.ask }).pipe(
      Effect.tapError(() => Effect.sync(() => awaited.get(row.id) === now.eventId && awaited.delete(row.id))),
    );
  });

  const standings = Effect.fnUntraced(function* () {
    for (const row of yield* list.attention()) yield* standing(row);
  });

  const stalls = new Map<string, string>();

  const stalled = Effect.fnUntraced(
    function* (threadId: string, runId: string, since: string) {
      const lineage = yield* threads.summaries(yield* reads.lineage(threadId));
      const name = lineage.find((member) => member.id === threadId)?.name ?? null;
      const told = yield* Effect.forEach(lineage, (thread) =>
        Effect.exit(fan({ kind: 'stalled', thread, stalled: { id: threadId, name, runId, since } })),
      );
      const failed = told.find(Exit.isFailure);
      if (failed !== undefined) return yield* failed;
    },
    (work, threadId, runId, since) =>
      Effect.tapError(work, () => Effect.sync(() => stalls.get(threadId) === `${runId}:${since}` && stalls.delete(threadId))),
  );

  if (taking('awaiting').length > 0) {
    const stop = list.subscribeAttention((event) => {
      if (event.kind === 'removed') awaited.delete(event.threadId);
      else watched(event.kind === 'resync' ? standings() : standing(event.row), 'a thread awaiting the operator');
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
  }

  if (taking('stalled').length > 0) {
    const stop = states((state) => {
      const status = state.status;
      if (status.life !== 'stalled' || status.runId === null) return void stalls.delete(state.thread.id);
      const since = state.thread.updatedAt.toISOString();
      const key = `${status.runId}:${since}`;
      if (stalls.get(state.thread.id) === key) return;
      stalls.set(state.thread.id, key);
      watched(stalled(state.thread.id, status.runId, since), 'a stalled thread');
    });
    yield* Effect.addFinalizer(() => Effect.sync(stop));
  }

  const start = Effect.fn('ThreadEvents.start')(function* () {
    if (taking('awaiting').length > 0) yield* standings();
    if (cooling.length === 0) return;
    for (const thread of yield* threads.summaries(yield* reads.cached)) {
      for (const recipient of cooling) {
        if (yield* recipient.follows(thread)) {
          yield* watch(thread);
          break;
        }
      }
    }
  });

  const told = Effect.fn('ThreadEvents.told')(function* (threadId: string, fact: ThreadFact) {
    const thread = yield* threads.summary(threadId).pipe(Effect.mapError(broke));
    if (thread === undefined) return;
    yield* fan({ ...fact, thread });
  });

  const serveDecisions = (served: ThreadDecisions['Service']) => {
    decisions = served;
    return () => {
      if (decisions === served) decisions = null;
    };
  };

  return { subscribers: recipients.map(subscriberOf), start, told, serveDecisions };
});
