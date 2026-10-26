import { Data, Deferred, Duration, Effect, Fiber, FiberSet, Result } from 'effect';
import type { ThreadCompactionPoint } from '@runlith/agent/thread/storage/inbox';
import type { ChatDraft, ChatTurnOpening } from '../ChatDraft';
import type { ChatQuestionAnswer } from '../entries';
import type { PromptHistory } from '../PromptHistory';
import type { ChatNotice, ChatTold } from '../notice';
import { ChatConnection, type ChatCommandFailure, type ChatCompactAsk, type ChatThreadView, refusedTold } from '../wire/ChatConnection';
import type { AnswerDelivery, PendingTurns } from './PendingTurns';
import { ThreadOpening } from './ThreadOpening.svelte';
import { ThreadSession } from './ThreadSession.svelte';
import type { StopPhase, ThreadStopOutcome, ThreadStops, WordsReturn } from './ThreadStops.svelte';
import type { TurnShaping } from './TurnShaping';
import { type WaitingFailure, WaitingWords } from './WaitingWords.svelte';

export type ChatTurnAction = 'send' | 'answer' | 'compact';

export type ChatTurnFailure<TDraft> =
  | { kind: 'no-thread'; action: 'compact' | 'answer' | 'continue' }
  | { kind: 'run-active'; action: ChatTurnAction }
  | { kind: 'send-refused'; message: string; told?: ChatTold | undefined; draft: TDraft }
  | { kind: 'send-lost'; message: string }
  | { kind: 'send-late' }
  | { kind: 'birth-failed'; message: string }
  | { kind: 'discard-failed'; message: string }
  | { kind: 'command-lost'; message: string }
  | { kind: 'compact-refused'; message: string; told?: ChatTold | undefined; code?: string }
  | { kind: 'continue-refused'; message: string; told?: ChatTold | undefined }
  | { kind: 'answer-refused'; message: string; told?: ChatTold | undefined }
  | { kind: 'stop-refused'; message: string; told?: ChatTold | undefined }
  | { kind: 'nothing-running' }
  | { kind: 'stop-mismatch'; runId: string }
  | WaitingFailure
  | { kind: 'question-closed' }
  | { kind: 'question-settled' }
  | { kind: 'answer-in-flight' };

export type ChatBorn = { readonly threadId: string; readonly draftKey: string };

export class ChatBirthFailed extends Data.TaggedError('ChatBirthFailed')<{ readonly message: string }> {}

export interface ChatBirth {
  born(): Effect.Effect<ChatBorn | null, ChatBirthFailed>;
  discard(threadId: string): Effect.Effect<void, ChatBirthFailed>;
  settled(): Effect.Effect<void>;
}

export type TurnCommandsOptions = {
  readonly birthDeadlineMs?: number;
};

const BIRTH_DEADLINE_MS = 30_000;

export type ChatSendOptions = {
  clearCurrent?: boolean;
  queue?: boolean;
};

export type TurnTarget<TThread extends ChatThreadView> = ThreadSession<TThread> | ThreadOpening;

export type TurnRun = <A>(work: Effect.Effect<A>, otherwise: A) => Promise<A>;

type SendOutcome =
  | { readonly kind: 'unborn' }
  | { readonly kind: 'late' }
  | { readonly kind: 'birth-failed'; readonly message: string }
  | { readonly kind: 'uncomposed'; readonly notice: ChatNotice; readonly discardFailed: string | null }
  | { readonly kind: 'refused'; readonly message: string; readonly told: ChatTold | undefined }
  | { readonly kind: 'lost'; readonly message: string }
  | { readonly kind: 'sent'; readonly threadId: string; readonly accepted: Fiber.Fiber<ChatNotice | null> };

type Told<A, TDraft> = readonly [A, ChatTurnFailure<TDraft> | null];

export type ChatHalt = 'stop' | StopPhase;

type Lane = { readonly born: Deferred.Deferred<void>; readonly sent: Deferred.Deferred<void> };

type Bearing = { readonly born: ChatBorn; users: number; delivered: boolean };

export class TurnCommands<TDraft, TThread extends ChatThreadView> {
  busy = $state<'answer' | 'compact' | 'continue' | null>(null);
  target = $state.raw<TurnTarget<TThread>>(new ThreadOpening());
  private shown = $state.raw<{ readonly target: TurnTarget<TThread>; readonly notice: ChatNotice } | null>(null);
  private sending = $state(0);
  private readonly lanes = new Map<string | ThreadOpening, Lane>();
  private readonly bornFrom = new WeakMap<ThreadOpening, Bearing>();
  private readonly bornOpenings = new Map<string, ThreadOpening>();

  session = $derived(this.target instanceof ThreadSession ? this.target : null);
  opening = $derived(this.target instanceof ThreadOpening ? this.target : null);
  threadId = $derived(this.session?.threadId ?? null);
  runId = $derived(this.session?.activeRunId ?? null);
  halt = $derived.by<ChatHalt | null>(() => {
    const session = this.session;
    const runId = session?.activeRunId ?? null;
    if (session === null || runId === null) return null;
    return this.stops.phase(session.threadId, runId) ?? 'stop';
  });
  pending = $derived(this.busy !== null || this.sending > 0);
  freeformQuestion = $derived(this.session?.freeformQuestion ?? null);
  canSend = $derived.by(() => this.draft.filled(this.draft.current));

  private constructor(
    private readonly connection: ChatConnection<TThread>,
    private readonly turns: PendingTurns,
    private readonly stops: ThreadStops,
    private readonly shaping: TurnShaping,
    readonly draft: ChatDraft<TDraft>,
    private readonly birth: ChatBirth,
    private readonly noticeOf: (failure: ChatTurnFailure<TDraft>) => ChatNotice | null,
    private readonly drive: TurnRun,
    readonly history: PromptHistory | undefined,
    private readonly fork: (work: Effect.Effect<void>) => Fiber.Fiber<void>,
    private readonly birthDeadlineMs: number,
  ) {
    this.waiting = new WaitingWords(
      connection,
      turns,
      draft,
      () => this.session,
      (failure) => noticeOf(failure),
      (session, notice) => this.post(session, notice),
      fork,
    );
  }

  readonly waiting: WaitingWords<TDraft, TThread>;

  static readonly make = Effect.fnUntraced(function* <TDraft, TThread extends ChatThreadView>(
    turns: PendingTurns,
    stops: ThreadStops,
    shaping: TurnShaping,
    draft: ChatDraft<TDraft>,
    birth: ChatBirth,
    noticeOf: (failure: ChatTurnFailure<TDraft>) => ChatNotice | null,
    drive: TurnRun,
    history: PromptHistory | undefined,
    options: TurnCommandsOptions = {},
  ) {
    const connection = yield* ChatConnection<TThread>();
    const fork = yield* FiberSet.makeRuntime<never, void, never>();
    const deadline = options.birthDeadlineMs ?? BIRTH_DEADLINE_MS;
    return new TurnCommands<TDraft, TThread>(
      connection,
      turns,
      stops,
      shaping,
      draft,
      birth,
      noticeOf,
      drive,
      history,
      (work) => fork(work),
      deadline,
    );
  });

  get notice(): ChatNotice | null {
    const shown = this.shown;
    return shown !== null && shown.target === this.target ? shown.notice : null;
  }

  say(notice: ChatNotice): void {
    this.post(this.target, notice);
  }

  dismiss(): void {
    this.shown = null;
  }

  run<A>(work: Effect.Effect<A>, otherwise: A): Promise<A> {
    return this.drive(work, otherwise);
  }

  relay(settled: Effect.Effect<ChatNotice | null>): Effect.Effect<void> {
    return Effect.suspend(() => {
      const target = this.target;
      return Effect.map(settled, (notice) => {
        if (notice !== null) this.post(target, notice);
      });
    });
  }

  forget(inputId: string): void {
    this.turns.forget(inputId);
  }

  resend(inputId: string): Effect.Effect<void> {
    return this.turns.resend(inputId);
  }

  aim(target: TurnTarget<TThread>): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.shown?.target !== target) this.shown = null;
      this.target = target;
    });
  }

  send(): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const freeform = this.freeformQuestion;
      const current = this.draft.current;
      const text = this.draft.textOf(current).trim();
      if (!freeform || !text || this.draft.attached(current)) return this.sendDraft(this.draft.clone(current), { clearCurrent: true });
      this.draft.clear();
      return Effect.as(this.answerQuestion(freeform.questionId, [{ questionId: freeform.promptId, values: [text] }]), true);
    });
  }

  queueDraft(): Effect.Effect<boolean> {
    return Effect.suspend(() => this.sendDraft(this.draft.clone(this.draft.current), { clearCurrent: true, queue: true }));
  }

  sendDraft(next: TDraft, options: ChatSendOptions = {}): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      if (!this.draft.filled(next)) return Effect.succeed(false);
      this.sending += 1;
      this.shown = null;
      const opening = this.draft.opening(next);
      const target = this.target;
      const session = this.session;
      const inputId = crypto.randomUUID();
      const start = {
        inputId,
        threadId: session?.threadId ?? null,
        draftKey: this.draft.key,
        opening,
        bubble: !session?.activeRunId,
        queue: options.queue === true,
        giveBack: (key: string) => this.draft.handBack(key, next),
      };
      this.draft.setAside(inputId, next);
      this.turns.begin(start);
      if (target instanceof ThreadOpening) target.show({ ...start, state: 'sending' });
      if (options.clearCurrent) this.draft.clear();
      const lane = this.laneOf(target);
      const ahead = this.lanes.get(lane) ?? null;
      const mine: Lane = { born: Deferred.makeUnsafe<void>(), sent: Deferred.makeUnsafe<void>() };
      this.lanes.set(lane, mine);
      const shaped = this.shaping.settled(start.threadId ?? start.draftKey);
      const turn = this.delivery(inputId, start.threadId, target, next, opening, options, ahead, mine, shaped).pipe(
        Effect.ensuring(this.leave(lane, ahead, mine)),
      );
      return this.turns.outlive(turn).pipe(
        Effect.flatMap((delivering) => this.waited(delivering, target, inputId)),
        Effect.flatMap((outcome) => this.sent(outcome, inputId, target, opening, next)),
        Effect.ensuring(
          Effect.sync(() => {
            this.sending -= 1;
          }),
        ),
      );
    });
  }

  loadOlder(): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const session = this.session;
      if (!session) return Effect.succeed(false);
      return Effect.map(Effect.result(session.loadOlder()), (read) => {
        if (Result.isSuccess(read)) return read.success;
        this.post(session, { tone: 'error', message: read.failure.message });
        return false;
      });
    });
  }

  loadEntry(entryId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.session;
      if (!session) return Effect.void;
      return Effect.map(Effect.result(session.loadEntry(entryId)), (read) => {
        if (Result.isFailure(read)) this.post(session, { tone: 'error', message: read.failure.message });
      });
    });
  }

  answerQuestion(questionId: string, answers: readonly ChatQuestionAnswer[]): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.session;
      if (!session) return this.tell({ kind: 'no-thread', action: 'answer' });
      if (!session.fold.asking(questionId)) return this.tell({ kind: 'question-closed' });
      if (!session.activeRunId) {
        session.fold.clearQuestion(questionId);
        return this.tell({ kind: 'question-settled' });
      }
      if (this.busy) return this.tell({ kind: 'answer-in-flight' });
      this.busy = 'answer';
      this.shown = null;
      const answer = {
        questionId,
        answers: answers.map((one) => ({ questionId: one.questionId, values: [...one.values], annotation: one.annotation })),
        key: crypto.randomUUID(),
      };
      const answered = Effect.map(this.turns.answer(session.threadId, answer), (delivery) => {
        const failure = answerFailure<TDraft>(delivery);
        if (failure !== null) this.post(session, this.noticeOf(failure));
      });
      return Effect.ensuring(answered, this.idle('answer'));
    });
  }

  continue(): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const session = this.session;
      if (!session) return Effect.as(this.tell({ kind: 'no-thread', action: 'continue' }), false);
      if (this.busy) return Effect.succeed(false);
      this.busy = 'continue';
      this.shown = null;
      const continued = Effect.map(Effect.result(this.connection.continue(session.threadId)), (result): Told<boolean, TDraft> => {
        if (Result.isFailure(result))
          return [
            false,
            failed(result.failure, { kind: 'continue-refused', message: result.failure.message, told: refusedTold(result.failure) }),
          ];
        return [result.success.status === 'started', null];
      });
      return Effect.ensuring(this.command(session, continued), this.idle('continue'));
    });
  }

  compact(at?: ThreadCompactionPoint, summarizer?: ChatCompactAsk['summarizer']): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      const session = this.session;
      if (!session) return Effect.as(this.tell({ kind: 'no-thread', action: 'compact' }), false);
      if (this.busy) return Effect.succeed(false);
      this.busy = 'compact';
      this.shown = null;
      const ask = { at, summarizer };
      const compacted = Effect.map(Effect.result(this.connection.compact(session.threadId, ask)), (result): Told<boolean, TDraft> => {
        if (Result.isFailure(result)) {
          const failure = result.failure;
          const code = failure._tag === 'ChatCommandRefused' && failure.code !== undefined ? { code: failure.code } : {};
          return [false, failed(failure, { kind: 'compact-refused', message: failure.message, told: refusedTold(failure), ...code })];
        }
        const compaction = result.success;
        if (compaction.status === 'requested' || compaction.status === 'started') return [true, null];
        return [false, { kind: 'run-active', action: 'compact' }];
      });
      return Effect.ensuring(this.command(session, compacted), this.idle('compact'));
    });
  }

  stop(): Effect.Effect<void> {
    return Effect.suspend(() => {
      const session = this.session;
      const runId = session?.activeRunId ?? null;
      if (session === null || runId === null) return Effect.void;
      this.shown = null;
      const draftKey = this.draft.key;
      const back: WordsReturn = (words) =>
        Effect.map(this.draft.takeBack(draftKey, [words]), (notice) => {
          if (notice !== null) this.post(session, notice);
        });
      return Effect.map(this.stops.stop(session.threadId, runId, back), (outcome) => {
        const failure = stopFailure<TDraft>(outcome);
        if (failure !== null) this.post(session, this.noticeOf(failure));
      });
    });
  }

  private delivery(
    inputId: string,
    named: string | null,
    target: TurnTarget<TThread>,
    next: TDraft,
    opening: ChatTurnOpening,
    options: ChatSendOptions,
    ahead: Lane | null,
    mine: Lane,
    shaped: Effect.Effect<void>,
  ): Effect.Effect<SendOutcome> {
    return Effect.suspend(() => {
      const bore = { value: false };
      return this.deliver(inputId, named, target, next, opening, options, ahead, mine, shaped, bore).pipe(
        Effect.ensuring(Effect.suspend(() => (bore.value ? this.birth.settled() : Effect.void))),
      );
    });
  }

  private readonly deliver = Effect.fnUntraced(function* (
    this: TurnCommands<TDraft, TThread>,
    inputId: string,
    named: string | null,
    target: TurnTarget<TThread>,
    next: TDraft,
    opening: ChatTurnOpening,
    options: ChatSendOptions,
    ahead: Lane | null,
    mine: Lane,
    shaped: Effect.Effect<void>,
    bore: { value: boolean },
  ) {
    if (ahead !== null) yield* Deferred.await(ahead.born);
    let threadId = named;
    let bearing = threadId === null && target instanceof ThreadOpening ? (this.bornFrom.get(target) ?? null) : null;
    if (bearing !== null) {
      bearing.users += 1;
      threadId = bearing.born.threadId;
      this.turns.bind(inputId, bearing.born.threadId, bearing.born.draftKey);
    }
    if (threadId === null) {
      yield* shaped;
      const birth = yield* Effect.result(this.birth.born());
      if (Result.isFailure(birth)) {
        this.turns.refuse(inputId);
        return { kind: 'birth-failed', message: birth.failure.message } as const;
      }
      const born = birth.success;
      if (born === null) {
        this.turns.refuse(inputId);
        return { kind: 'unborn' } as const;
      }
      threadId = born.threadId;
      bore.value = true;
      this.turns.bind(inputId, born.threadId, born.draftKey);
      if (target instanceof ThreadOpening) {
        bearing = { born, users: 1, delivered: false };
        this.bornFrom.set(target, bearing);
        this.bornOpenings.set(born.threadId, target);
      }
    }
    Deferred.doneUnsafe(mine.born, Effect.void);
    const composed = yield* this.draft.compose(threadId, next);
    if (composed.status === 'failed') {
      this.turns.refuse(inputId);
      if (bearing !== null) bearing.users -= 1;
      const abandoned = bearing !== null && bearing.users === 0 && !bearing.delivered;
      const discarded = abandoned ? yield* Effect.result(this.birth.discard(threadId)) : null;
      if (abandoned && target instanceof ThreadOpening) this.unborn(target, threadId);
      const discardFailed = discarded !== null && Result.isFailure(discarded) ? discarded.failure.message : null;
      return { kind: 'uncomposed', notice: composed.notice, discardFailed } as const;
    }
    if (bearing !== null) bearing.delivered = true;
    const words = {
      text: opening.text,
      key: inputId,
      attachments: composed.attachments?.length ? composed.attachments : undefined,
    };
    if (named !== null) yield* shaped;
    if (ahead !== null) yield* Deferred.await(ahead.sent);
    const delivery = yield* this.turns.deliver(inputId, threadId, words, options.queue === true);
    Deferred.doneUnsafe(mine.sent, Effect.void);
    if (delivery.kind === 'lost') return { kind: 'lost', message: delivery.failure.message } as const;
    if (delivery.kind === 'refused')
      return { kind: 'refused', message: delivery.failure.message, told: refusedTold(delivery.failure) } as const;
    const accepted = yield* this.turns.outlive(this.draft.accepted(threadId, next));
    return { kind: 'sent', threadId, accepted } as const;
  });

  private waited(delivering: Fiber.Fiber<SendOutcome>, target: TurnTarget<TThread>, inputId: string): Effect.Effect<SendOutcome> {
    if (!(target instanceof ThreadOpening)) return Fiber.join(delivering);
    return Effect.timeoutOrElse(Fiber.join(delivering), {
      duration: Duration.millis(this.birthDeadlineMs),
      orElse: () => this.abandoned(delivering, target, inputId),
    });
  }

  private readonly abandoned = Effect.fnUntraced(function* (
    this: TurnCommands<TDraft, TThread>,
    delivering: Fiber.Fiber<SendOutcome>,
    target: ThreadOpening,
    inputId: string,
  ) {
    target.late();
    yield* this.turns.outlive(
      Effect.andThen(
        Fiber.await(delivering),
        Effect.sync(() => target.settle(inputId)),
      ),
    );
    return { kind: 'late' } as const;
  });

  private readonly sent = Effect.fnUntraced(function* (
    this: TurnCommands<TDraft, TThread>,
    outcome: SendOutcome,
    inputId: string,
    target: TurnTarget<TThread>,
    opening: ChatTurnOpening,
    next: TDraft,
  ) {
    if (target instanceof ThreadOpening && outcome.kind !== 'late') target.settle(inputId);
    switch (outcome.kind) {
      case 'unborn':
        return false;
      case 'late':
        this.post(target, this.noticeOf({ kind: 'send-late' }));
        return false;
      case 'birth-failed':
        this.post(target, this.noticeOf({ kind: 'birth-failed', message: outcome.message }));
        return false;
      case 'uncomposed':
        this.post(
          target,
          outcome.discardFailed === null
            ? outcome.notice
            : (this.noticeOf({ kind: 'discard-failed', message: outcome.discardFailed }) ?? outcome.notice),
        );
        return false;
      case 'refused':
        this.post(target, this.noticeOf({ kind: 'send-refused', message: outcome.message, told: outcome.told, draft: next }));
        return false;
      case 'lost':
        this.post(target, this.noticeOf({ kind: 'send-lost', message: outcome.message }));
        return false;
      case 'sent': {
        this.history?.record(opening.text);
        const accepted = yield* Fiber.join(outcome.accepted);
        const session = this.session;
        if (accepted !== null && session?.threadId === outcome.threadId) this.post(session, accepted);
        return true;
      }
    }
  });

  private post(target: TurnTarget<TThread>, notice: ChatNotice | null): void {
    if (this.target !== target) return;
    this.shown = notice === null ? null : { target, notice };
  }

  private command<A>(session: ThreadSession<TThread>, work: Effect.Effect<Told<A, TDraft>>): Effect.Effect<A> {
    return Effect.map(session.owned(work), ([value, failure]) => {
      if (failure !== null) this.post(session, this.noticeOf(failure));
      return value;
    });
  }

  private laneOf(target: TurnTarget<TThread>): string | ThreadOpening {
    if (target instanceof ThreadOpening) return target;
    return this.bornOpenings.get(target.threadId) ?? target.threadId;
  }

  private leave(lane: string | ThreadOpening, ahead: Lane | null, mine: Lane): Effect.Effect<void> {
    const after = (step: (lane: Lane) => Deferred.Deferred<void>) => (ahead === null ? Effect.void : Deferred.await(step(ahead)));
    const done = (step: Deferred.Deferred<void>) => Effect.sync(() => Deferred.doneUnsafe(step, Effect.void));
    const passed = after((one) => one.born).pipe(
      Effect.andThen(done(mine.born)),
      Effect.andThen(after((one) => one.sent)),
      Effect.andThen(done(mine.sent)),
      Effect.andThen(Effect.sync(() => this.release(lane, mine))),
    );
    return Effect.asVoid(this.turns.outlive(passed));
  }

  private release(lane: string | ThreadOpening, mine: Lane): void {
    if (this.lanes.get(lane) !== mine) return;
    this.lanes.delete(lane);
    if (!(lane instanceof ThreadOpening)) return;
    const bearing = this.bornFrom.get(lane);
    if (bearing !== undefined && this.bornOpenings.get(bearing.born.threadId) === lane) this.bornOpenings.delete(bearing.born.threadId);
  }

  private unborn(opening: ThreadOpening, threadId: string): void {
    this.bornFrom.delete(opening);
    if (this.bornOpenings.get(threadId) === opening) this.bornOpenings.delete(threadId);
  }

  private tell(failure: ChatTurnFailure<TDraft>): Effect.Effect<void> {
    return Effect.sync(() => this.post(this.target, this.noticeOf(failure)));
  }

  private idle(busy: 'answer' | 'continue' | 'compact'): Effect.Effect<void> {
    return Effect.sync(() => {
      if (this.busy === busy) this.busy = null;
    });
  }
}

function answerFailure<TDraft>(delivery: AnswerDelivery): ChatTurnFailure<TDraft> | null {
  switch (delivery.kind) {
    case 'answered':
      return delivery.started.status === 'already-running' ? { kind: 'run-active', action: 'answer' } : null;
    case 'refused':
      return { kind: 'answer-refused', message: delivery.failure.message, told: refusedTold(delivery.failure) };
    case 'lost':
      return null;
  }
}

function failed<TDraft>(failure: ChatCommandFailure, refused: ChatTurnFailure<TDraft>): ChatTurnFailure<TDraft> {
  return failure._tag === 'ChatCommandLost' ? { kind: 'command-lost', message: failure.message } : refused;
}

export function stopFailure<TDraft>(outcome: ThreadStopOutcome): ChatTurnFailure<TDraft> | null {
  if (outcome.kind === 'failed')
    return failed(outcome.failure, { kind: 'stop-refused', message: outcome.failure.message, told: refusedTold(outcome.failure) });
  if (outcome.kind === 'repeated') return null;
  switch (outcome.stop.status) {
    case 'nothing-running':
      return { kind: 'nothing-running' };
    case 'run-mismatch':
      return { kind: 'stop-mismatch', runId: outcome.stop.runId };
    default:
      return null;
  }
}
