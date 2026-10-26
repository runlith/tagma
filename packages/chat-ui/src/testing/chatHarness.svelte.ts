import { Effect, Exit, FiberSet, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';
import type { SerializedThreadRun } from '@runlith/agent/protocol/http';
import type { ThreadEventDelta } from '@runlith/agent/transcript/eventFold';
import {
  type FeedPosition,
  RUN_END_STATUSES,
  type RunEndStatus,
  type RunLife,
  type RunStatus,
  type ThreadLiveProgress,
  type ThreadOpenChange,
  type ThreadWaitingAttachment,
} from '@runlith/agent/transcript/live';
import type { ChatComposedTurn, ChatDraft, ChatTakenWords, ChatTurnOpening } from '../ChatDraft';
import type { ChatEntryHandlers } from '../entries';
import type { PromptHistory } from '../PromptHistory';
import type { ChatNotice } from '../notice';
import { DetachedSessions } from '../session/DetachedSessions';
import { PendingTurns, type PendingTurnsOptions } from '../session/PendingTurns';
import { ThreadOpening } from '../session/ThreadOpening.svelte';
import { ThreadSession, type ThreadSessionOptions } from '../session/ThreadSession.svelte';
import { ThreadStops } from '../session/ThreadStops.svelte';
import { TurnShaping } from '../session/TurnShaping';
import { type ChatBirth, type ChatBorn, type ChatTurnFailure, TurnCommands } from '../session/TurnCommands.svelte';
import { ChatConnection, type ChatFeedEvent, type ChatState, type ThreadContextReading, type ThreadModes } from '../wire/ChatConnection';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { TestConnection, type TestThread } from './chatConnection';
import { MemoryShelf } from './pendingShelf';

export type TestDraft = { text: string; attachments: readonly string[] };

export function draft(text: string, attachments: readonly string[] = []): TestDraft {
  return { text, attachments };
}

export class TestDrafts {
  readonly slots = $state<Record<string, TestDraft>>({});

  at(key: string): TestDraft {
    return this.slots[key] ?? draft('');
  }

  put(key: string, value: TestDraft): void {
    this.slots[key] = value;
  }

  merge(key: string, back: TestDraft): void {
    const held = this.at(key);
    this.slots[key] = {
      text: [back.text.trim(), held.text.trim()].filter(Boolean).join('\n\n'),
      attachments: [...back.attachments, ...held.attachments],
    };
  }
}

export class TestDraftState implements ChatDraft<TestDraft> {
  key = $state('new:test');
  readonly delivered: TestDraft[] = [];
  late: ChatNotice | null = null;
  composeFails: ChatNotice | null = null;

  constructor(readonly drafts: TestDrafts = new TestDrafts()) {}

  get current(): TestDraft {
    return this.drafts.at(this.key);
  }

  set(value: TestDraft): void {
    this.drafts.put(this.key, value);
  }

  clear(): void {
    this.drafts.put(this.key, draft(''));
  }

  setText(value: string): void {
    this.drafts.put(this.key, { ...this.current, text: value });
  }

  filled(next: TestDraft): boolean {
    return next.text.trim().length > 0 || next.attachments.length > 0;
  }

  attached(next: TestDraft): boolean {
    return next.attachments.length > 0;
  }

  textOf(next: TestDraft): string {
    return next.text;
  }

  clone(next: TestDraft): TestDraft {
    return { text: next.text, attachments: [...next.attachments] };
  }

  opening(next: TestDraft): ChatTurnOpening {
    return { text: next.text.trim() };
  }

  compose(_threadId: string, next: TestDraft): Effect.Effect<ChatComposedTurn> {
    return Effect.sync(() =>
      this.composeFails
        ? { status: 'failed', notice: this.composeFails }
        : { status: 'composed', attachments: next.attachments.length ? next.attachments.map((id) => ({ id })) : undefined },
    );
  }

  accepted(_threadId: string, next: TestDraft): Effect.Effect<ChatNotice | null> {
    return Effect.sync(() => {
      this.delivered.push(next);
      return this.late;
    });
  }

  handBack(key: string, back: TestDraft): void {
    this.drafts.merge(key, back);
  }

  takeBack(key: string, words: readonly ChatTakenWords[]): Effect.Effect<ChatNotice | null> {
    return Effect.sync(() => {
      this.drafts.merge(
        key,
        draft(
          words.map((one) => one.text).join('\n\n'),
          words.flatMap((one) => one.attachments.map((attachment) => attachment.url)),
        ),
      );
      return null;
    });
  }

  setAside(): void {}
}

export type HolderOptions = {
  readonly birthDeadlineMs?: number;
  readonly notice?: (failure: ChatTurnFailure<TestDraft>) => ChatNotice | null;
  readonly draft?: TestDraftState;
  readonly history?: PromptHistory;
  readonly birth?: ChatBirth;
};

export type TestChat = Effect.Success<ReturnType<typeof makeChat>>;
export type TestSession = Effect.Success<ReturnType<TestChat['open']>>;

export const makeChat = Effect.fnUntraced(function* (shelf: MemoryShelf = new MemoryShelf(), options: PendingTurnsOptions = {}) {
  const connection = new TestConnection();
  const detached = new DetachedSessions<TestThread>();
  const scope = yield* Scope.fork(yield* Effect.scope);
  const provided = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | ChatConnection<TestThread>>, owner: Scope.Scope = scope) =>
    effect.pipe(Effect.provideService(ChatConnection<TestThread>(), connection), Scope.provide(owner));
  const pending = yield* provided(PendingTurns.make(shelf, { resendPauseMs: 5, ...options }));
  const stops = yield* provided(ThreadStops.make(pending));
  const shaping = new TurnShaping();
  const drive = yield* Scope.provide(FiberSet.makeRuntimePromise<never>(), scope);

  const open = Effect.fnUntraced(function* (
    threadId = 'thread-1',
    options: ThreadSessionOptions<TestThread> & { readonly handlers?: ChatEntryHandlers } = {},
  ) {
    const owned = yield* Scope.fork(scope);
    const session = yield* provided(ThreadSession.make<TestThread>(threadId, pending, options.handlers ?? {}, options), owned);
    yield* session.attach();
    yield* Effect.yieldNow;
    return {
      session,
      scope: owned,
      detach: Effect.fnUntraced(function* () {
        const held = yield* session.detach();
        if (held) detached.put(session.threadId, held);
        yield* Scope.close(owned, Exit.void);
      }),
      dispose: () => Scope.close(owned, Exit.void),
    };
  });
  const holder = Effect.fnUntraced(function* (
    target: ThreadSession<TestThread> | ThreadOpening,
    options: HolderOptions = {},
    owner: Scope.Scope = scope,
  ) {
    const commands = yield* provided(
      TurnCommands.make<TestDraft, TestThread>(
        pending,
        stops,
        shaping,
        options.draft ?? new TestDraftState(),
        options.birth ?? bornAs('thread-1'),
        options.notice ?? (() => ({ tone: 'error', message: 'refused' })),
        (work) => drive(work),
        options.history,
        { birthDeadlineMs: options.birthDeadlineMs },
      ),
      owner,
    );
    yield* commands.aim(target);
    return commands;
  });
  yield* Effect.yieldNow;
  return { connection, detached, scope, shelf, pending, stops, shaping, open, holder };
});

export function bornAs(threadId: string, draftKey = `thread:${threadId}`): ChatBirth {
  return {
    born: (): Effect.Effect<ChatBorn | null> => Effect.succeed({ threadId, draftKey }),
    discard: () => Effect.void,
    settled: () => Effect.void,
  };
}

export const settle = TestClock.adjust(0);

export const MEASURED_AT = '2026-01-01T00:05:30.000Z';
export const RUN_STARTED_AT = '2026-01-01T00:00:00.000Z';

export type SnapshotInput = {
  readonly activeRunId?: string | null;
  readonly life?: RunLife;
  readonly transcript?: readonly unknown[];
  readonly open?: readonly unknown[];
  readonly progress?: ThreadLiveProgress | null;
  readonly position?: number;
  readonly seq?: number;
  readonly before?: number | null;
  readonly latestRun?: Partial<SerializedThreadRun> | null;
  readonly queued?: readonly WaitingRow[];
  readonly steers?: readonly WaitingRow[];
  readonly arrived?: readonly { id: string; occurredAt: string }[];
  readonly receipts?: RunStatus['receipts'];
  readonly withdrawn?: string;
  readonly withdrawnWords?: string;
  readonly now?: string;
  readonly phase?: { phase: string; since: number };
  readonly modes?: ThreadModes;
  readonly contextReading?: ThreadContextReading;
  readonly contextLimit?: ThreadContextLimit | null;
  readonly history?: 'journal' | 'session' | 'none';
};

type WaitingRow = { id: string; text: string; kind?: 'compaction'; keep?: string; attachments?: readonly ThreadWaitingAttachment[] };

const isRunEnd = (status: string): status is RunEndStatus => (RUN_END_STATUSES as readonly string[]).includes(status);

export function state(input: SnapshotInput = {}): ChatState<TestThread> {
  const activeRunId = input.activeRunId ?? null;
  const row = (row: WaitingRow) => ({
    ...row,
    runId: 'run-1',
    occurredAt: '2026-01-01T00:00:00.000Z',
  });
  const latestRun = input.latestRun ? ({ ...runRow('run-1'), ...input.latestRun } as SerializedThreadRun) : null;
  const ending =
    input.withdrawn !== undefined && activeRunId === null
      ? {
          runId: input.withdrawn,
          status: 'withdrawn' as const,
          stoppedBy: 'reader' as const,
          failureReason: null,
          finishedAt: '2026-01-01T00:04:00.000Z',
          notification: 'confirmed' as const,
          words: input.withdrawnWords === undefined ? undefined : { text: input.withdrawnWords },
        }
      : latestRun !== null && activeRunId === null && isRunEnd(latestRun.status)
        ? {
            runId: latestRun.id,
            status: latestRun.status,
            stoppedBy: latestRun.settledBy ?? null,
            failureReason: latestRun.failureReason ?? null,
            finishedAt: latestRun.finishedAt ?? '2026-01-01T00:04:00.000Z',
            notification: 'confirmed' as const,
          }
        : undefined;
  return {
    thread: { id: 'thread-1', capabilities: input.history === undefined ? undefined : { history: input.history, steer: 'step' } },
    modes: input.modes,
    contextReading: input.contextReading,
    contextLimit: input.contextLimit,
    activeRun: activeRunId ? runRow(activeRunId, input.phase) : null,
    latestRun,
    status: {
      threadId: 'thread-1',
      runId: activeRunId,
      life: input.life ?? (activeRunId ? 'working' : 'idle'),
      stage: null,
      openQuestions: [],
      since: activeRunId ? RUN_STARTED_AT : null,
      receipts: input.receipts ?? [],
      ending,
    },
    now: input.now ?? MEASURED_AT,
    pendingInput: {
      queued: (input.queued ?? []).map(row),
      steers: (input.steers ?? []).map(row),
      arrived: (input.arrived ?? []).map((arrival) => ({
        type: 'signal' as const,
        id: `transcript:signal:${arrival.id}`,
        title: 'reviewer',
        signalType: 'message',
        addressee: 'transport' as const,
        text: 'look at this before you commit',
        occurredAt: arrival.occurredAt,
      })),
    },
  };
}

export function at(position = 0, seq = 1): FeedPosition {
  return { position, seq };
}

export function snapshotEvent(input: SnapshotInput = {}): ChatFeedEvent<TestThread> {
  return {
    type: 'snapshot',
    at: at(input.position ?? 0, input.seq ?? 1),
    payload: {
      status: 'loaded',
      snapshot: {
        ...state(input),
        transcript: (input.transcript ?? []) as readonly ThreadTranscriptEntry[],
        before: input.before ?? null,
        open: (input.open ?? []) as readonly ThreadTranscriptEntry[],
        progress: input.progress ?? null,
      },
    },
  };
}

export function stateEvent(
  input: SnapshotInput,
  position: FeedPosition,
  records: readonly ThreadEventDelta[] = [],
): ChatFeedEvent<TestThread> {
  return { type: 'state', at: position, payload: { records, snapshot: state(input) } };
}

export function openEvent(change: ThreadOpenChange, position: FeedPosition): ChatFeedEvent<TestThread> {
  return { type: 'open', at: position, change };
}

function runRow(id: string, phase?: { phase: string; since: number }): SerializedThreadRun {
  return {
    id,
    threadId: 'thread-1',
    status: 'running',
    ownerId: 'owner-1',
    provider: 'openai-oauth',
    model: 'gpt-5.6-sol',
    account: null,
    reasoning: null,
    switches: {},
    progress: { stage: 'streaming', message: null, phase },
    usage: null,
    failureReason: null,
    failure: null,
    settledBy: null,
    settledNotification: null,
    createdAt: RUN_STARTED_AT,
    startedAt: RUN_STARTED_AT,
    heartbeatAt: RUN_STARTED_AT,
    finishedAt: null,
    updatedAt: RUN_STARTED_AT,
  } as SerializedThreadRun;
}
