import { Cause, Clock, Data, Deferred, Duration, Effect, Exit, Fiber, Scope, Stream } from 'effect';
import type { AgentPhase } from '@runlith/agent/AgentPhase';
import type { RunLife, RunStatus, ThreadLiveProgress, WordsWait } from '@runlith/agent/transcript/live';
import { signalEntryId } from '@runlith/agent/transcript/entryNames';
import { ChatFold, type ChatStreamTurn } from '../ChatFold.svelte';
import type { ChatThreadPhase } from '../chatThreadPhase';
import { chatContextSource, type ChatLiveContext } from '../contextUsage';
import type { ThreadContextLimit } from '@runlith/agent/thread/compaction/limit';
import { type ChatEntryHandlers, questionOpen } from '../entries';
import { isToolConfirmationEntry } from '../entryProjection';
import type { ChatQueuedTurnItem } from './FeedVerdicts';
import {
  ChatConnection,
  type ChatFeedFailure,
  type ChatFeedItem,
  type ChatReadRefused,
  type ChatState,
  type ChatThreadView,
  type ThreadContextReading,
  type ThreadModes,
} from '../wire/ChatConnection';
import type { DetachedSession } from './DetachedSessions';
import { FeedReader } from './FeedReader';
import { FEED_GAPS, FeedGap, feedGapPolicy, feedRecoveryPolicy, readRecoveryPolicy } from './feedRetry';
import { OPEN_TEXT_MAX } from '@runlith/agent/transcript/openText';
import { type ChatRunEnding, type FeedReading, type FeedStill, LIVE_FEED, runEnding, runVerdict, waitingItems } from './FeedVerdicts';
import type { PendingAnswer, PendingTurn, PendingTurns, PendingWatcher } from './PendingTurns';

export type ThreadSessionStatus = 'loading' | 'ready' | 'failed';

export type ThreadSessionOptions<TThread extends ChatThreadView> = {
  readonly detached?: DetachedSession<TThread>;
  readonly openingDeadlineMs?: number;
};

export class ThreadUnreadable extends Data.TaggedError('ThreadUnreadable')<{ readonly message: string }> {}

const OPENING_DEADLINE_MS = 10_000;

export class ThreadSession<TThread extends ChatThreadView> implements PendingWatcher {
  readonly fold: ChatFold;
  status = $state<ThreadSessionStatus>('loading');
  errors = $state<readonly string[]>([]);
  thread = $state.raw<TThread | null>(null);
  modes = $state.raw<ThreadModes | null>(null);
  private contextReading = $state.raw<ThreadContextReading>(null);
  private contextLimit = $state.raw<ThreadContextLimit | null>(null);
  private runStatus = $state.raw<RunStatus | null>(null);
  activeRunId = $derived(this.runStatus?.runId ?? null);
  life = $derived<RunLife | null>(this.status === 'failed' ? null : (this.runStatus?.life ?? null));
  runStartedAt = $state<number | null>(null);
  runPhase = $state<AgentPhase | null>(null);
  feed = $state.raw<FeedReading>(LIVE_FEED);
  verdict = $derived(runVerdict(this.runStatus, this.feed, this.runPhase, this.runStartedAt));
  private estimate = $state.raw<{ readonly runId: string; readonly value: NonNullable<ThreadLiveProgress['estimate']> } | null>(null);
  ending = $state<ChatRunEnding | null>(null);
  private waitingLater = $state.raw<readonly ChatQueuedTurnItem[]>([]);
  private waitingNext = $state.raw<readonly ChatQueuedTurnItem[]>([]);
  private sending = $state.raw<readonly SentWords[]>([]);
  readsMidRun = $derived(this.thread?.capabilities?.steer !== 'none');
  queued = $derived([...this.waitingLater, ...this.sending.filter((sent) => sent.queue || !this.readsMidRun).map((sent) => sent.item)]);
  pendingSteers = $derived([
    ...this.waitingNext,
    ...this.sending.filter((sent) => !sent.queue && this.readsMidRun).map((sent) => sent.item),
  ]);
  wordsWait = $derived<WordsWait | null>(this.runStatus?.wordsWait ?? null);
  hasOlder = $state(false);

  liveContext = $derived.by<ChatLiveContext | null>(() =>
    this.estimate === null
      ? null
      : {
          runId: this.estimate.runId,
          provider: this.activeRunModel.provider,
          model: this.activeRunModel.model,
          estimate: this.estimate.value,
        },
  );
  contextSource = $derived.by(() => chatContextSource({ reading: this.contextReading, live: this.liveContext, limit: this.contextLimit }));
  threadPhase = $derived.by<ChatThreadPhase>(() => {
    if (this.status === 'ready') return { kind: 'open', threadId: this.threadId };
    if (this.status === 'failed') return { kind: 'unreadable', threadId: this.threadId, errors: this.errors };
    return { kind: 'opening', threadId: this.threadId };
  });
  freeformQuestion = $derived.by(() => {
    const questions = this.fold.index.of('question');
    for (let index = questions.length - 1; index >= 0; index -= 1) {
      const entry = questions[index]!;
      if (!questionOpen(entry)) continue;
      if (isToolConfirmationEntry(entry) || entry.prompts.length !== 1) return null;
      const prompt = entry.prompts[0];
      if (!prompt || (!prompt.allowFreeform && prompt.options?.length)) return null;
      return { questionId: entry.questionId, promptId: prompt.id };
    }
    return null;
  });

  private clockOffsetMs = $state(0);
  private stateReadAt = 0;
  private frameAt: number | null = null;
  private resync = false;
  private progressPhase: AgentPhase | null = null;
  private activeRunModel = $state.raw<{ provider: string | null; model: string | null }>({ provider: null, model: null });
  private attached: Scope.Closeable | null = null;
  private first: Deferred.Deferred<void, ThreadUnreadable> | null = null;
  private paging: Deferred.Deferred<boolean, ChatReadRefused> | null = null;
  private reader: FeedReader<TThread>;
  private readonly bubbles = new Map<string, ChatStreamTurn>();
  private readonly prefixing = new Map<string, number>();
  private readonly deadlineMs: number;

  private constructor(
    readonly threadId: string,
    private readonly connection: ChatConnection<TThread>,
    private readonly pending: PendingTurns,
    private readonly scope: Scope.Scope,
    private readonly handlers: ChatEntryHandlers,
    options: ThreadSessionOptions<TThread>,
  ) {
    this.fold = options.detached?.fold ?? new ChatFold(handlers);
    this.reader = new FeedReader(this.fold, options.detached ?? null);
    this.deadlineMs = options.openingDeadlineMs ?? OPENING_DEADLINE_MS;
  }

  get clockOffset(): number {
    return this.clockOffsetMs;
  }

  static readonly make = Effect.fnUntraced(function* <TThread extends ChatThreadView>(
    threadId: string,
    pending: PendingTurns,
    handlers: ChatEntryHandlers,
    options: ThreadSessionOptions<TThread> = {},
  ) {
    const session = new ThreadSession<TThread>(threadId, yield* ChatConnection<TThread>(), pending, yield* Effect.scope, handlers, options);
    const detached = options.detached;
    if (detached) session.applyState(detached.state, detached.readAt);
    yield* Effect.addFinalizer(() => session.closeAttach());
    yield* pending.watch(threadId, session);
    for (const turn of pending.of(threadId)) session.shown(turn);
    for (const answer of pending.answersOf(threadId)) session.answering(answer);
    return session;
  });

  readonly attach = Effect.fnUntraced(function* <T extends ChatThreadView>(this: ThreadSession<T>) {
    yield* this.closeAttach();
    const scope = yield* Scope.fork(this.scope);
    this.attached = scope;
    const first = yield* Deferred.make<void, ThreadUnreadable>();
    this.first = first;
    yield* Effect.forkIn(
      this.reading(first).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)
            ? Effect.sync(() => this.unreadable('closed', Cause.pretty(exit.cause)))
            : Effect.void,
        ),
      ),
      scope,
    );
    yield* Effect.forkIn(
      Effect.timeoutOrElse(Effect.exit(Deferred.await(first)), {
        duration: Duration.millis(this.deadlineMs),
        orElse: () => Effect.sync(() => this.unreadable('broken', openingLate(this.deadlineMs))),
      }),
      scope,
    );
  });

  opened(): Effect.Effect<boolean> {
    return Effect.suspend(() =>
      this.first === null ? Effect.succeed(false) : Effect.map(Effect.exit(Deferred.await(this.first)), Exit.isSuccess),
    );
  }

  readonly detach = Effect.fnUntraced(function* <T extends ChatThreadView>(this: ThreadSession<T>) {
    yield* this.closeAttach();
    for (const turn of this.bubbles.values()) this.fold.retract(turn);
    this.bubbles.clear();
    this.fold.withdrawAnswers();
    const at = this.reader.at;
    const state = this.reader.state;
    const held: DetachedSession<T> | null = at === null || state === null ? null : { fold: this.fold, at, state, readAt: this.stateReadAt };
    return held;
  });

  loadOlder(): Effect.Effect<boolean, ChatReadRefused> {
    return Effect.suspend(() => {
      if (this.paging) return Deferred.await(this.paging);
      const cursor = this.fold.before;
      if (cursor === null) return Effect.succeed(false);
      const paging = Deferred.makeUnsafe<boolean, ChatReadRefused>();
      this.paging = paging;
      const page = this.connection.entriesBefore(this.threadId, cursor).pipe(
        Effect.flatMap((read) =>
          Effect.map(Effect.void, () => {
            this.fold.prepend(read.entries, read.before);
            this.hasOlder = this.fold.before !== null;
            return read.entries.length > 0;
          }),
        ),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (this.paging === paging) this.paging = null;
          }).pipe(Effect.andThen(Deferred.done(paging, exit))),
        ),
      );
      return Effect.andThen(Effect.forkIn(page, this.scope), Deferred.await(paging));
    });
  }

  loadEntry(entryId: string): Effect.Effect<void, ChatReadRefused> {
    return this.owned(
      Effect.map(this.connection.entry(this.threadId, entryId), (whole) => {
        if (whole) this.fold.replaceEntry(whole, entryId);
      }),
    );
  }

  owned<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.flatMap(Effect.forkIn(work, this.scope), Fiber.join);
  }

  waiting(inputId: string): ChatQueuedTurnItem | undefined {
    return this.waitingLater.find((item) => item.id === inputId) ?? this.waitingNext.find((item) => item.id === inputId);
  }

  unqueued(inputId: string): void {
    this.waitingLater = this.waitingLater.filter((item) => item.id !== inputId);
    this.waitingNext = this.waitingNext.filter((item) => item.id !== inputId);
  }

  revise(thread: TThread, modes?: ThreadModes): void {
    this.thread = thread;
    if (modes !== undefined) this.modes = modes;
  }

  shown(turn: PendingTurn): void {
    if (!turn.bubble && turn.state === 'sending') {
      if (!this.sending.some((sent) => sent.item.id === turn.inputId)) this.sending = [...this.sending, sentWords(turn)];
      return;
    }
    this.unsent(turn.inputId);
    if (this.bubbles.has(turn.inputId)) return;
    const previews = turn.opening.previews;
    const bubble = this.fold.beginUserMessage({
      text: turn.opening.text,
      turnKey: turn.inputId,
      attachments: previews?.length ? previews : undefined,
    });
    this.bubbles.set(turn.inputId, bubble);
    if (turn.state === 'unconfirmed') this.fold.unconfirmed(bubble);
  }

  answering(pending: PendingAnswer): void {
    const { questionId, answers, key } = pending.answer;
    this.fold.sendAnswer(questionId, { key, answers, unconfirmed: pending.state === 'unconfirmed' });
  }

  answered(inputId: string): void {
    this.fold.confirmAnswer(inputId);
  }

  unconfirmed(inputId: string): void {
    const turn = this.bubbles.get(inputId);
    if (turn) this.fold.unconfirmed(turn);
    this.fold.unconfirmedAnswer(inputId);
  }

  adopted(inputId: string, runId: string): void {
    this.unsent(inputId);
    const turn = this.bubbles.get(inputId);
    if (!turn) return;
    this.bubbles.delete(inputId);
    this.fold.adoptUserMessage(turn, runId);
    this.retireWithdrawn();
  }

  accepted(inputId: string, runId: string, itemId: string | null): void {
    const sent = this.sending.find((one) => one.item.id === inputId);
    if (sent !== undefined) {
      const taken = { ...sent, into: runId, itemId };
      if (this.listed(taken)) this.unsent(inputId);
      else this.sending = this.sending.map((one) => (one === sent ? taken : one));
    }
    this.retract(inputId);
  }

  retired(inputId: string): void {
    this.unsent(inputId);
    this.retract(inputId);
    this.fold.withdrawAnswer(inputId);
  }

  private retract(inputId: string): void {
    const turn = this.bubbles.get(inputId);
    if (!turn) return;
    this.bubbles.delete(inputId);
    this.fold.retract(turn);
  }

  private retireWithdrawn(): void {
    const ending = this.runStatus?.ending;
    if (ending?.status === 'withdrawn') this.fold.runWithdrawn(ending.runId);
  }

  private closeAttach(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const attached = this.attached;
      const first = this.first;
      this.attached = null;
      this.first = null;
      this.prefixing.clear();
      if (first) Deferred.doneUnsafe(first, Effect.interrupt);
      return attached === null ? Effect.void : Scope.close(attached, Exit.void);
    });
  }

  private reading(first: Deferred.Deferred<void, ThreadUnreadable>): Effect.Effect<void> {
    return this.connection
      .feed(
        this.threadId,
        Effect.sync(() => (this.resync ? null : this.reader.at)),
      )
      .pipe(
        Stream.mapEffect((item) => this.take(item, first)),
        Stream.retry(feedGapPolicy),
        Stream.tapError((failure) => Effect.sync(() => this.fell(failure))),
        Stream.retry(feedRecoveryPolicy),
        Stream.runDrain,
        Effect.catchTags({
          FeedGap: () => Effect.sync(() => this.unreadable('closed', feedSkipping(FEED_GAPS))),
          ChatFeedBroken: (broken) => Effect.sync(() => this.unreadable('closed', broken.message)),
          ChatFeedRefused: (refused) => Effect.sync(() => this.unreadable('closed', refused.message)),
        }),
      );
  }

  private fell(failure: FeedGap | ChatFeedFailure): void {
    if (failure._tag === 'ChatFeedRefused') return;
    if (failure._tag === 'FeedGap') this.resync = true;
    this.unreadable('broken', failure._tag === 'FeedGap' ? feedSkipping(FEED_GAPS) : failure.message);
  }

  private take(item: ChatFeedItem<TThread>, first: Deferred.Deferred<void, ThreadUnreadable>): Effect.Effect<void, FeedGap> {
    if (item.type === 'interrupted') return Effect.sync(() => this.unreadable('lost', item.message));
    const read = this.reader.read(item);
    if (read.kind === 'gap') return Effect.fail(new FeedGap());
    for (const key of this.fold.settledAnswers()) this.pending.concluded(key);
    if (read.state !== null) this.resync = false;
    return Effect.flatMap(Clock.currentTimeMillis, (now) => {
      this.frameAt = now;
      if (read.state !== null) this.applyState(read.state, now);
      if (read.progress !== undefined) this.applyProgress(read.progress);
      return Effect.andThen(this.fetchPrefixes(), Effect.asVoid(Deferred.succeed(first, undefined)));
    });
  }

  private fetchPrefixes(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const scope = this.attached;
      const lacking = this.fold.lacking();
      const standing = new Set(lacking.map((one) => one.id));
      for (const id of this.prefixing.keys()) if (!standing.has(id)) this.prefixing.delete(id);
      if (scope === null) return Effect.void;
      const fresh = lacking.filter((one) => this.prefixing.get(one.id) !== one.from);
      for (const one of fresh) this.prefixing.set(one.id, one.from);
      return Effect.forEach(
        fresh,
        (one) => Effect.forkIn(Effect.andThen(Effect.retry(this.prefixOf(one.id), readRecoveryPolicy), this.fetchPrefixes()), scope),
        { discard: true },
      );
    });
  }

  private prefixOf(entryId: string): Effect.Effect<void, ChatReadRefused> {
    return Effect.suspend(() => {
      const from = this.fold.lacking().find((one) => one.id === entryId)?.from;
      if (from === undefined) return Effect.void;
      this.prefixing.set(entryId, from);
      const start = Math.max(0, from - OPEN_TEXT_MAX);
      return Effect.flatMap(this.connection.text(this.threadId, entryId, start, from - start), (read) =>
        read !== null && this.fold.prefix(entryId, read.from, read.text) ? this.prefixOf(entryId) : Effect.void,
      );
    });
  }

  private unreadable(kind: FeedStill, message: string): void {
    this.status = 'failed';
    this.feed = { kind, reason: message, asOf: this.frameAt };
    if (this.errors[this.errors.length - 1] !== message) this.errors = [...this.errors, message];
    if (this.first) Deferred.doneUnsafe(this.first, Effect.fail(new ThreadUnreadable({ message })));
  }

  private applyState(state: ChatState<TThread>, now: number): void {
    const previousRunId = this.activeRunId;
    this.stateReadAt = now;
    this.frameAt = now;
    this.status = 'ready';
    this.feed = LIVE_FEED;
    this.errors = [];
    this.thread = state.thread;
    this.modes = state.modes ?? null;
    this.contextReading = state.contextReading ?? null;
    this.contextLimit = state.contextLimit ?? null;
    this.runStatus = state.status;
    this.ending = runEnding(state);
    this.retireWithdrawn();
    this.hasOlder = this.fold.before !== null;
    const address = (url: string) => this.handlers.attachmentUrl?.(url) ?? url;
    this.waitingLater = waitingItems(state.pendingInput.queued, [], address);
    this.waitingNext = waitingItems(state.pendingInput.steers, state.pendingInput.arrived, address);
    const runId = state.status.runId;
    if (this.sending.length > 0) {
      this.sending = this.sending.filter((sent) => !this.listed(sent));
    }
    this.pending.observe(this.threadId, state);
    this.stampRunClocks(state, now);
    if (previousRunId && runId === null) this.estimate = null;
  }

  private applyProgress(progress: ThreadLiveProgress | null): void {
    const runId = this.activeRunId;
    this.progressPhase = progress?.phase ?? null;
    this.runPhase = this.progressPhase === null ? null : { ...this.progressPhase, since: this.progressPhase.since - this.clockOffsetMs };
    this.estimate = runId === null || progress?.estimate == null ? null : { runId, value: progress.estimate };
  }

  private stampRunClocks(state: ChatState<TThread>, now: number): void {
    const measuredAt = Date.parse(state.now);
    if (!Number.isNaN(measuredAt)) this.clockOffsetMs = measuredAt - now;
    const activeRun = state.activeRun;
    this.activeRunModel = { provider: activeRun?.provider ?? null, model: activeRun?.model ?? null };
    if (!activeRun) {
      this.runStartedAt = null;
      this.runPhase = null;
      this.progressPhase = null;
      return;
    }
    this.runStartedAt = Date.parse(activeRun.startedAt) - this.clockOffsetMs;
    if (this.progressPhase !== null) this.runPhase = { ...this.progressPhase, since: this.progressPhase.since - this.clockOffsetMs };
  }

  private listed(sent: SentWords): boolean {
    if (this.runStatus?.receipts.some((receipt) => receipt.key === sent.item.id)) return true;
    if (sent.into === null) return false;
    if (this.runStatus?.runId !== sent.into) return true;
    const itemId = sent.itemId;
    if (itemId === null) return false;
    return [...this.waitingLater, ...this.waitingNext].some((item) => item.id === itemId) || this.fold.standing(signalEntryId(itemId));
  }

  private unsent(inputId: string): void {
    if (this.sending.some((sent) => sent.item.id === inputId)) this.sending = this.sending.filter((sent) => sent.item.id !== inputId);
  }
}

type SentWords = {
  readonly item: ChatQueuedTurnItem;
  readonly queue: boolean;
  readonly into: string | null;
  readonly itemId: string | null;
};

function sentWords(turn: PendingTurn): SentWords {
  return {
    item: {
      id: turn.inputId,
      kind: 'turn',
      text: turn.opening.text,
      attachments: turn.opening.previews ?? [],
      sender: null,
      intent: null,
      notice: null,
      removable: false,
      at: new Date().toISOString(),
    },
    queue: turn.queue,
    into: null,
    itemId: null,
  };
}

function feedSkipping(gaps: number): string {
  return `The live feed skipped events ${gaps + 1} times in a row; it is read again from a fresh snapshot.`;
}

function openingLate(deadlineMs: number): string {
  return `No opening frame arrived within ${deadlineMs / 1000}s. The live feed is connected to nothing that answers, or the answer is stuck on the way.`;
}
