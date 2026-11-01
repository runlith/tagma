import { Data, Duration, Effect, Fiber, Result, Schedule, type Scope, Stream } from 'effect';
import type { ThreadAttachment } from '@runlith/agent/transcript/entries';
import type { FeedHeld } from '@runlith/agent/transcript/feedFold';
import type { FeedPosition } from '@runlith/agent/transcript/live';
import type { ChatTurnOpening } from '../ChatDraft';
import {
  type ChatAnswer,
  ChatCommandLost,
  ChatConnection,
  type ChatCommandFailure,
  type ChatFeedFailure,
  type ChatFeedItem,
  type ChatSaid,
  type ChatState,
  type ChatThreadView,
  type ChatTurnStart,
  type ChatWords,
} from '../wire/ChatConnection';
import { type FeedTarget, FeedReader } from './FeedReader';
import { FeedGap, feedGapPolicy, feedRecoveryPolicy } from './feedRetry';

export type PendingState = 'sending' | 'unconfirmed';

export type PendingTurn = {
  readonly inputId: string;
  readonly threadId: string | null;
  readonly opening: ChatTurnOpening;
  readonly bubble: boolean;
  readonly queue: boolean;
  readonly state: PendingState;
};

export type PendingStart = {
  readonly inputId: string;
  readonly threadId: string | null;
  readonly draftKey: string;
  readonly opening: ChatTurnOpening;
  readonly bubble: boolean;
  readonly queue?: boolean;
  readonly stored?: readonly ThreadAttachment[];
  giveBack(draftKey: string): void;
};

export type PendingAnswer = {
  readonly threadId: string;
  readonly answer: ChatAnswer;
  readonly state: PendingState;
};

export interface PendingWatcher {
  shown(turn: PendingTurn): void;
  answering(answer: PendingAnswer): void;
  adopted(inputId: string, runId: string): void;
  accepted(inputId: string, runId: string, itemId: string | null): void;
  answered(inputId: string): void;
  retired(inputId: string): void;
  unconfirmed(inputId: string): void;
}

export interface StatusWatch {
  wants(threadId: string): boolean;
  observe(threadId: string, state: ChatState<ChatThreadView>): void;
}

type Undelivered =
  | { readonly kind: 'refused'; readonly failure: ChatCommandFailure }
  | { readonly kind: 'lost'; readonly failure: ChatCommandFailure };

type Said = { readonly kind: 'accepted'; readonly said: ChatSaid };

type Answered = { readonly kind: 'answered'; readonly started: ChatTurnStart };

export type Delivery = Said | Undelivered;

export type AnswerDelivery = Answered | Undelivered;

export type Transmitted = { readonly words: ChatWords; readonly queue: boolean };

export type KeptTurn = {
  readonly inputId: string;
  readonly at: number;
  readonly threadId: string | null;
  readonly draftKey: string;
  readonly text: string;
  readonly bubble: boolean;
  readonly stored?: readonly ThreadAttachment[];
  readonly sent: Transmitted | null;
};

export type KeptAnswer = {
  readonly inputId: string;
  readonly at: number;
  readonly threadId: string;
  readonly answer: ChatAnswer;
};

export type KeptAct = KeptTurn | KeptAnswer;

export interface PendingShelf {
  keep(act: KeptAct): void;
  drop(inputId: string): void;
  orphans(): Effect.Effect<readonly KeptAct[]>;
  handBack(turn: KeptTurn): void;
}

type HeldTurn = PendingStart & {
  readonly kind: 'turn';
  readonly at: number;
  threadId: string | null;
  draftKey: string;
  state: PendingState;
  sent: Transmitted | null;
  resending: boolean;
};

type HeldAnswer = {
  readonly kind: 'answer';
  readonly inputId: string;
  readonly at: number;
  readonly threadId: string;
  readonly answer: ChatAnswer;
  state: PendingState;
  resending: boolean;
};

type Held = HeldTurn | HeldAnswer;

class Unconfirmed extends Data.TaggedError('Unconfirmed') {}

class StatusTarget implements FeedTarget {
  held(at: FeedPosition | null): FeedHeld {
    return {
      at,
      entry: () => undefined,
      record: () => undefined,
      ofRun: () => [],
      open: () => false,
      openOfRun: () => [],
      openIds: () => [],
    };
  }

  apply(): void {}
}

const RESENDS = 4;
const RESEND_PAUSE_MS = 1000;
//! Admission answers before the model runs; past this the press ends and the call's own answer or a receipt settles the turn.
const ANSWER_MS = 15_000;
const OVERDUE = 'The server has not answered yet; the message stays pending until it is confirmed.';

export type PendingTurnsOptions = { readonly resendPauseMs?: number; readonly answerMs?: number };

export class PendingTurns {
  private readonly turns = new Map<string, Held>();
  private readonly byThread = new Map<string, Set<string>>();
  private readonly watchers = new Map<string, Set<PendingWatcher>>();
  private readonly tracked = new Set<StatusWatch>();
  private readonly followed = new Set<string>();

  private constructor(
    private readonly connection: ChatConnection<ChatThreadView>,
    private readonly shelf: PendingShelf,
    private readonly scope: Scope.Scope,
    private readonly resendPauseMs: number,
    private readonly answerMs: number,
  ) {}

  static readonly make = Effect.fnUntraced(function* (
    shelf: PendingShelf,
    options: PendingTurnsOptions = {},
  ): Effect.fn.Return<PendingTurns, never, Scope.Scope | ChatConnection<ChatThreadView>> {
    const turns = new PendingTurns(
      yield* ChatConnection<ChatThreadView>(),
      shelf,
      yield* Effect.scope,
      options.resendPauseMs ?? RESEND_PAUSE_MS,
      options.answerMs ?? ANSWER_MS,
    );
    yield* turns.outlive(turns.revive());
    return turns;
  });

  begin(start: PendingStart): void {
    const held: HeldTurn = { ...start, kind: 'turn', at: Date.now(), state: 'sending', sent: null, resending: false };
    this.turns.set(start.inputId, held);
    this.shelf.keep(kept(held));
    if (held.threadId !== null) this.index(held.threadId, start.inputId);
    if (held.threadId !== null) this.tell(held.threadId, (watcher) => watcher.shown(view(held)));
  }

  carry<A, E>(work: Effect.Effect<A, E>): Effect.Effect<A, E> {
    return Effect.flatMap(this.outlive(work), Fiber.join);
  }

  outlive<A, E>(work: Effect.Effect<A, E>): Effect.Effect<Fiber.Fiber<A, E>> {
    return Effect.forkIn(work, this.scope);
  }

  bind(inputId: string, threadId: string, draftKey: string): void {
    const held = this.turns.get(inputId);
    if (held?.kind !== 'turn') return;
    held.threadId = threadId;
    held.draftKey = draftKey;
    this.shelf.keep(kept(held));
    this.index(threadId, inputId);
    this.tell(threadId, (watcher) => watcher.shown(view(held)));
  }

  deliver(inputId: string, threadId: string, words: ChatWords, queue: boolean): Effect.Effect<Delivery> {
    return Effect.suspend(() => {
      const held = this.turns.get(inputId);
      if (held?.kind === 'turn') {
        held.sent = { words, queue };
        this.shelf.keep(kept(held));
      }
      return this.dispatch(inputId, threadId, this.transmit(threadId, words, queue));
    });
  }

  answer(threadId: string, answer: ChatAnswer): Effect.Effect<AnswerDelivery> {
    return Effect.suspend(() => {
      const held: HeldAnswer = {
        kind: 'answer',
        inputId: answer.key,
        at: Date.now(),
        threadId,
        answer,
        state: 'sending',
        resending: false,
      };
      this.turns.set(held.inputId, held);
      this.shelf.keep(kept(held));
      this.index(threadId, held.inputId);
      this.tell(threadId, (watcher) => watcher.answering(answerView(held)));
      return this.carry(this.dispatch(held.inputId, threadId, this.reply(threadId, answer)));
    });
  }

  resend(inputId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const held = this.turns.get(inputId);
      if (held?.state !== 'unconfirmed' || held.resending) return Effect.void;
      held.resending = true;
      return Effect.asVoid(this.outlive(this.resending(inputId)));
    });
  }

  forget(inputId: string): void {
    if (this.turns.get(inputId)?.state === 'unconfirmed') this.refuse(inputId);
  }

  concluded(inputId: string): void {
    const held = this.turns.get(inputId);
    if (held?.kind !== 'answer') return;
    this.end(inputId);
    this.tell(held.threadId, (watcher) => watcher.answered(inputId));
  }

  of(threadId: string): readonly PendingTurn[] {
    const turns: PendingTurn[] = [];
    for (const inputId of this.byThread.get(threadId) ?? []) {
      const held = this.turns.get(inputId);
      if (held?.kind === 'turn') turns.push(view(held));
    }
    return turns;
  }

  answersOf(threadId: string): readonly PendingAnswer[] {
    const answers: PendingAnswer[] = [];
    for (const inputId of this.byThread.get(threadId) ?? []) {
      const held = this.turns.get(inputId);
      if (held?.kind === 'answer') answers.push(answerView(held));
    }
    return answers;
  }

  watch(threadId: string, watcher: PendingWatcher): Effect.Effect<void, never, Scope.Scope> {
    return Effect.acquireRelease(
      Effect.sync(() => {
        const set = this.watchers.get(threadId) ?? new Set();
        set.add(watcher);
        this.watchers.set(threadId, set);
      }),
      () =>
        Effect.suspend(() => {
          const set = this.watchers.get(threadId);
          set?.delete(watcher);
          if (set?.size !== 0) return Effect.void;
          this.watchers.delete(threadId);
          return this.follow(threadId);
        }),
    );
  }

  observe(threadId: string, state: ChatState<ChatThreadView>): void {
    for (const inputId of [...(this.byThread.get(threadId) ?? [])]) {
      const held = this.turns.get(inputId);
      if (held?.kind !== 'turn' || held.state !== 'unconfirmed') continue;
      const receipt = state.status.receipts.find((one) => one.key === inputId);
      if (receipt !== undefined) this.accept(inputId, receipt.status, receipt.runId, receipt.itemId);
    }
    for (const watch of [...this.tracked]) watch.observe(threadId, state);
  }

  track(watch: StatusWatch): void {
    this.tracked.add(watch);
  }

  follow(threadId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (this.followed.has(threadId) || this.watchers.has(threadId) || !this.demand(threadId)) return Effect.void;
      this.followed.add(threadId);
      return Effect.asVoid(
        this.outlive(
          this.following(threadId).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                this.followed.delete(threadId);
              }),
            ),
          ),
        ),
      );
    });
  }

  private dispatch<A extends Said | Answered>(
    inputId: string,
    threadId: string,
    transmitted: Effect.Effect<A | Undelivered>,
  ): Effect.Effect<A | Undelivered> {
    return Effect.flatMap(this.outlive(transmitted), (call) =>
      Effect.raceFirst(
        Effect.flatMap(Fiber.join(call), (delivery) => this.settled(inputId, threadId, delivery)),
        Effect.delay(this.overdue(inputId, threadId, call), Duration.millis(this.answerMs)),
      ),
    );
  }

  private settled<A extends Said | Answered>(inputId: string, threadId: string, delivery: A | Undelivered): Effect.Effect<A | Undelivered> {
    return Effect.suspend((): Effect.Effect<A | Undelivered> => {
      this.settleDelivery(inputId, delivery);
      return delivery.kind === 'lost'
        ? Effect.as(Effect.andThen(this.resend(inputId), this.follow(threadId)), delivery)
        : Effect.succeed(delivery);
    });
  }

  private overdue<A extends Said | Answered>(
    inputId: string,
    threadId: string,
    call: Fiber.Fiber<A | Undelivered>,
  ): Effect.Effect<A | Undelivered> {
    return Effect.suspend(() => {
      const held = this.turns.get(inputId);
      if (held) held.resending = true;
      this.lose(inputId);
      const answered = Effect.flatMap(Fiber.join(call), (delivery) =>
        Effect.suspend(() => {
          if (held) held.resending = false;
          return this.settled(inputId, threadId, delivery);
        }),
      );
      const lost: Undelivered = { kind: 'lost', failure: new ChatCommandLost({ message: OVERDUE }) };
      return Effect.as(Effect.andThen(this.outlive(answered), this.follow(threadId)), lost);
    });
  }

  private revive(): Effect.Effect<void> {
    return Effect.flatMap(this.shelf.orphans(), (orphans) => {
      const pressed = orphans.toSorted((a, b) => a.at - b.at);
      for (const act of pressed.toReversed()) {
        if ('answer' in act || (act.sent !== null && act.threadId !== null)) continue;
        this.shelf.handBack(act);
        this.shelf.drop(act.inputId);
      }
      return Effect.forEach(
        pressed,
        (act) => {
          const held = this.revived(act);
          if (held === null || held.threadId === null) return Effect.void;
          const threadId = held.threadId;
          this.turns.set(held.inputId, held);
          this.index(threadId, held.inputId);
          if (held.kind === 'answer') this.tell(threadId, (watcher) => watcher.answering(answerView(held)));
          else this.tell(threadId, (watcher) => watcher.shown(view(held)));
          return Effect.andThen(this.resend(held.inputId), this.follow(threadId));
        },
        { discard: true },
      );
    });
  }

  private revived(act: KeptAct): Held | null {
    if ('answer' in act) return { kind: 'answer', ...act, state: 'unconfirmed', resending: false };
    if (act.sent === null || act.threadId === null) return null;
    return {
      kind: 'turn',
      inputId: act.inputId,
      at: act.at,
      threadId: act.threadId,
      draftKey: act.draftKey,
      opening: { text: act.text },
      bubble: act.bubble,
      stored: act.stored,
      giveBack: (draftKey) => this.shelf.handBack({ ...act, draftKey }),
      state: 'unconfirmed',
      sent: act.sent,
      resending: false,
    };
  }

  private transmit(threadId: string, words: ChatWords, queue: boolean): Effect.Effect<Delivery> {
    const sent = queue ? this.connection.queue(threadId, words) : this.connection.send(threadId, words);
    return Effect.map(Effect.result(sent), (result): Delivery => {
      if (Result.isSuccess(result)) return { kind: 'accepted', said: result.success };
      return undelivered(result.failure);
    });
  }

  private reply(threadId: string, answer: ChatAnswer): Effect.Effect<AnswerDelivery> {
    return Effect.map(Effect.result(this.connection.answer(threadId, answer)), (result): AnswerDelivery => {
      if (Result.isSuccess(result)) return { kind: 'answered', started: result.success };
      return undelivered(result.failure);
    });
  }

  private retransmit(held: Held): Effect.Effect<Delivery | AnswerDelivery> | null {
    if (held.kind === 'answer') return this.reply(held.threadId, held.answer);
    return held.sent === null || held.threadId === null ? null : this.transmit(held.threadId, held.sent.words, held.sent.queue);
  }

  private settleDelivery(inputId: string, delivery: Delivery | AnswerDelivery): void {
    switch (delivery.kind) {
      case 'accepted':
        this.accept(inputId, delivery.said.status, delivery.said.runId, itemOf(delivery.said));
        return;
      case 'answered':
        this.answered(inputId, delivery.started);
        return;
      case 'refused':
        this.refuse(inputId);
        return;
      case 'lost':
        this.lose(inputId);
        return;
    }
  }

  private resending(inputId: string): Effect.Effect<void> {
    const pause = Duration.millis(this.resendPauseMs);
    const attempt = Effect.suspend((): Effect.Effect<void, Unconfirmed> => {
      const held = this.turns.get(inputId);
      const again = held?.state === 'unconfirmed' ? this.retransmit(held) : null;
      if (again === null) return Effect.void;
      return Effect.flatMap(again, (delivery) => {
        if (delivery.kind === 'lost') return Effect.fail(new Unconfirmed());
        this.settleDelivery(inputId, delivery);
        return Effect.void;
      });
    });
    const schedule = Schedule.upTo(Schedule.exponential(Duration.times(pause, 2)), { times: RESENDS - 1 });
    return Effect.asVoid(Effect.exit(Effect.delay(Effect.retry(attempt, schedule), pause))).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const held = this.turns.get(inputId);
          if (held) held.resending = false;
        }),
      ),
    );
  }

  private accept(inputId: string, status: ChatSaid['status'], runId: string, itemId: string | null): void {
    const held = this.end(inputId);
    if (!held?.threadId) return;
    this.tell(held.threadId, (watcher) =>
      status === 'started' ? watcher.adopted(inputId, runId) : watcher.accepted(inputId, runId, itemId),
    );
  }

  private answered(inputId: string, started: ChatTurnStart): void {
    const held = this.end(inputId);
    if (!held?.threadId) return;
    this.tell(held.threadId, (watcher) => (started.status === 'started' ? watcher.answered(inputId) : watcher.retired(inputId)));
  }

  refuse(inputId: string): void {
    const held = this.turns.get(inputId);
    if (!held) return;
    if (held.kind === 'turn') held.giveBack(held.draftKey);
    this.end(inputId);
    if (held.threadId !== null) this.tell(held.threadId, (watcher) => watcher.retired(inputId));
  }

  private lose(inputId: string): void {
    const held = this.turns.get(inputId);
    if (!held) return;
    held.state = 'unconfirmed';
    if (held.threadId === null) return;
    if (held.kind === 'turn') this.tell(held.threadId, (watcher) => watcher.shown(view(held)));
    this.tell(held.threadId, (watcher) => watcher.unconfirmed(inputId));
  }

  private following(threadId: string): Effect.Effect<void, ChatFeedFailure | FeedGap> {
    const reader = new FeedReader<ChatThreadView>(new StatusTarget());
    let resync = false;
    return this.connection
      .feed(
        threadId,
        Effect.sync(() => (resync ? null : reader.at)),
      )
      .pipe(
        Stream.mapEffect((item) =>
          Effect.map(this.read(threadId, reader, item), (resolved) => {
            if (item.type === 'snapshot') resync = false;
            return resolved;
          }),
        ),
        Stream.retry(feedGapPolicy),
        Stream.tapError((failure) =>
          Effect.sync(() => {
            if (failure._tag === 'FeedGap') resync = true;
          }),
        ),
        Stream.retry(feedRecoveryPolicy.pipe(Schedule.while(() => this.demand(threadId) && !this.watchers.has(threadId)))),
        Stream.takeUntil((resolved) => resolved),
        Stream.runDrain,
      );
  }

  private read(threadId: string, reader: FeedReader<ChatThreadView>, item: ChatFeedItem<ChatThreadView>): Effect.Effect<boolean, FeedGap> {
    if (item.type === 'interrupted') return Effect.succeed(false);
    const read = reader.read(item);
    if (read.kind === 'gap') return Effect.fail(new FeedGap());
    if (read.state === null) return Effect.succeed(false);
    this.observe(threadId, read.state);
    return Effect.succeed(!this.demand(threadId) || this.watchers.has(threadId));
  }

  private demand(threadId: string): boolean {
    for (const watch of this.tracked) if (watch.wants(threadId)) return true;
    for (const inputId of this.byThread.get(threadId) ?? []) {
      const held = this.turns.get(inputId);
      if (held?.kind === 'turn' && held.state === 'unconfirmed') return true;
    }
    return false;
  }

  private index(threadId: string, inputId: string): void {
    const ids = this.byThread.get(threadId);
    if (ids === undefined) this.byThread.set(threadId, new Set([inputId]));
    else ids.add(inputId);
  }

  private end(inputId: string): Held | undefined {
    const held = this.turns.get(inputId);
    this.turns.delete(inputId);
    if (held) this.shelf.drop(inputId);
    if (held?.threadId) {
      const ids = this.byThread.get(held.threadId);
      ids?.delete(inputId);
      if (ids?.size === 0) this.byThread.delete(held.threadId);
    }
    return held;
  }

  private tell(threadId: string, act: (watcher: PendingWatcher) => void): void {
    for (const watcher of [...(this.watchers.get(threadId) ?? [])]) act(watcher);
  }
}

function itemOf(said: ChatSaid): string | null {
  switch (said.status) {
    case 'queued':
      return said.queued.id;
    case 'steered':
      return said.itemId;
    case 'started':
      return null;
  }
}

function undelivered(failure: ChatCommandFailure): Undelivered {
  return failure._tag === 'ChatCommandLost' ? { kind: 'lost', failure } : { kind: 'refused', failure };
}

function view(held: HeldTurn): PendingTurn {
  return {
    inputId: held.inputId,
    threadId: held.threadId,
    opening: held.opening,
    bubble: held.bubble,
    queue: held.queue === true,
    state: held.state,
  };
}

function answerView(held: HeldAnswer): PendingAnswer {
  return { threadId: held.threadId, answer: held.answer, state: held.state };
}

function kept(held: Held): KeptAct {
  if (held.kind === 'answer') return { inputId: held.inputId, at: held.at, threadId: held.threadId, answer: held.answer };
  return {
    inputId: held.inputId,
    at: held.at,
    threadId: held.threadId,
    draftKey: held.draftKey,
    text: held.opening.text,
    bubble: held.bubble,
    stored: held.stored,
    sent: held.sent,
  };
}
