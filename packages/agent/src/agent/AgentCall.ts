import { Cause, type Clock, Context, Deferred, Effect, Exit, Fiber, Latch, Option, type Scope, Tracer } from 'effect';
import { CostLedger, CurrentCost, endCost, type CostCause } from '@runlith/performance/CostLedger';
import { CallCancellation, type DeclaredCancellationCause } from '@runlith/executions/protocol/call';
import { agentSpan } from './spans';
import {
  callEnded,
  type CallAuthority,
  type CallControlResult,
  type CallExecution,
  type CallExecutionControl,
  type CallProgress,
  type CallRecord,
} from './callProgress';
export type CallCost = { readonly cause: CostCause; readonly owned: boolean };
export type CallHandoff = 'taken' | 'adopted';
export type Arrival = 'words' | 'report';
export type CallAttended<A, B> = { readonly handed: false; readonly value: A } | { readonly handed: true; readonly receipt: B };
export type CallTaking<B> = { readonly receipt: B } | { readonly refused: string };
export const WORDS_ENDED_WAIT = "The operator's words arrived while this call waited, so the wait ended for you to read them.";
export const REPORT_ENDED_WAIT = 'A report owed to you arrived while this call waited, so the wait ended for you to read it.';
export const WAIT_UNTOUCHED = 'Only this wait ended, and what it watched was not touched: answer what arrived first.';
export const RUN_STOPPED = 'The run was stopped.';
const STOPPED_WHILE_HANDED = 'The invocation was stopped while it was being handed to the background.';
const UNHANDABLE =
  'Nothing can carry this invocation to the background in its present stage: no thread owns its outcome, or it stands between stages.';
const envelopeStood = (budget: number): string => {
  const [amount, unit] =
    budget < 60_000
      ? ([Math.max(1, Math.round(budget / 1_000)), 'second'] as const)
      : budget < 3_600_000
        ? ([Math.round(budget / 60_000), 'minute'] as const)
        : ([Math.round(budget / 3_600_000), 'hour'] as const);
  return `${amount} ${unit}${amount === 1 ? '' : 's'}`;
};
const envelopeLapsed = (budget: number): string =>
  `The invocation stood for ${envelopeStood(budget)} with no answer and no ending — the runtime's own envelope for a call of this installation — so it was ended rather than left standing.`;
type CallTransition = {
  readonly phase?: CallRecord['phase'];
  readonly mode?: CallRecord['mode'];
  readonly detachable?: boolean;
  readonly detail?: string | null;
  readonly expiresAt?: number | null;
  readonly expiresBy?: CallRecord['expiresBy'];
  readonly limitCeilingMs?: number | null;
  readonly admittedAt?: number | null;
  readonly endedAt?: number | null;
  readonly executions?: readonly CallExecution[];
};
type Admission = {
  readonly at: number;
  readonly clock: bigint;
};
export type CallSide = {
  readonly scope: Scope.Scope;
  readonly clock: Clock.Clock;
  readonly runCallback: (work: Effect.Effect<void>) => Fiber.Fiber<void, never>;
  readonly publish: (record: CallRecord) => void;
  readonly envelopeMs: number;
  readonly unread: () => Arrival | null;
  readonly cost?: CallCost;
};
export type AgentCall = ReturnType<typeof makeAgentCall>;
export const makeAgentCall = (
  record: CallRecord,
  { scope, clock, runCallback: fork, publish, envelopeMs, unread, cost: inherited }: CallSide,
) => {
  const context = Fiber.getCurrent()?.context;
  const parentSpan = context === undefined ? undefined : Context.getOrUndefined(context, Tracer.ParentSpan);
  const ledger = context === undefined ? undefined : Context.getOrUndefined(context, CostLedger);
  const cost = inherited?.cause ?? ledger?.open(record.name, JSON.stringify([record.runId, record.toolCallId])) ?? null;
  const ownsCost = inherited?.owned ?? cost !== null;
  const withCost = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    cost === null ? work : Effect.provideService(work, CurrentCost, cost);
  const runCallback = (work: Effect.Effect<void>) => fork(withCost(work));
  let current = record;
  let cancellation: CallCancellation | null = null;
  const halting = Deferred.makeUnsafe<CallCancellation>();
  const ways = Latch.makeUnsafe(false);
  let way: Arrival | null = null;
  let detach: (() => void) | undefined;
  let fiber: Fiber.Fiber<void, never> | undefined;
  let keeping: Fiber.Fiber<never, never> | undefined;
  let timer: Fiber.Fiber<void, never> | undefined;
  let envelopeTimer: Fiber.Fiber<void, never> | undefined;
  let envelopeShows = false;
  let admitted: Admission | null = null;
  let canDetach = false;
  let answered = false;
  let handing: Deferred.Deferred<CallControlResult> | undefined;
  let admitting: Deferred.Deferred<void> | undefined;
  let taking: Effect.Effect<CallControlResult> | undefined;
  let claim: 'none' | 'handing' | 'handed' = 'none';
  let ahead = false;
  let owe: () => Effect.Effect<void, unknown> = () => Effect.void;
  let started = false;
  const ended = Deferred.makeUnsafe<void>();
  const moved = Deferred.makeUnsafe<void>();
  const resources = new Map<CallExecution, CallExecutionControl>();
  const commands = new Set<CallExecution>();
  let watches = false;
  const stops = Effect.asVoid(Deferred.await(halting));
  const stopped = () => cancellation !== null;
  const update = (change: CallTransition): void => {
    current = { ...current, ...change };
    publish(current);
  };
  const toBackground = (): void => {
    update({ mode: 'background', detachable: false, limitCeilingMs: null });
    Deferred.doneUnsafe(moved, Effect.void);
  };
  const askWay = (arrival: Arrival): void => {
    if (way !== 'words') way = arrival;
    ways.openUnsafe();
  };
  const makeWay = (): Effect.Effect<void> =>
    Effect.suspend(() => {
      const asked = way;
      way = null;
      if (asked === null || stopped() || callEnded(current) || current.mode !== 'foreground') return Effect.void;
      if (watches) {
        stop(asked === 'words' ? WORDS_ENDED_WAIT : REPORT_ENDED_WAIT);
        return Effect.void;
      }
      if (commands.size === 0) return Effect.void;
      return Effect.asVoid(handOff(asked === 'words' ? 'operator' : 'agent'));
    });
  const stage = (phase: 'preparing' | 'waiting' | 'running', detail: string | null = null): void => {
    if (!stopped() && !callEnded(current)) update({ phase, detail });
  };
  const stop = (reason: string, cause: DeclaredCancellationCause = 'explicit-stop'): void => {
    declare(reason, cause)?.();
  };
  const declare = (reason: string, cause: DeclaredCancellationCause): (() => void) | null => {
    if (stopped() || callEnded(current)) return null;
    const waiting = current.phase === 'waiting' && fiber === undefined && claim === 'none';
    update({ phase: 'stopping', detail: reason });
    const declared = new CallCancellation(cause, reason);
    cancellation = declared;
    return () => {
      Deferred.doneUnsafe(halting, Effect.succeed(declared));
      //! Stages before admission answer the stop themselves; cutting them would skip their own cleanup.
      if (!ahead) fiber?.interruptUnsafe();
      if (waiting) finish('stopped', reason);
    };
  };
  const adopt = (control: CallExecutionControl): void => {
    const moving = Effect.gen(function* () {
      const answer = yield* control.background!();
      yield* control.handed?.(answer.status !== 'unavailable') ?? Effect.void;
    });
    runCallback(moving);
  };
  const handOff = (authority: CallAuthority = 'operator'): Effect.Effect<CallControlResult> =>
    Effect.suspend(() => {
      if (handing !== undefined) return Deferred.await(handing);
      if (current.mode === 'background') return Effect.succeed({ status: 'changed', detail: null });
      if (stopped()) return Effect.succeed({ status: 'unavailable', detail: 'The invocation is stopping.' });
      if (admitting !== undefined) return Effect.andThen(Deferred.await(admitting), handOff(authority));
      if (taking !== undefined) return handed(taking);
      if (!canDetach || detach === undefined) return Effect.succeed({ status: 'unavailable', detail: UNHANDABLE });
      const pending = Deferred.makeUnsafe<CallControlResult>();
      handing = pending;
      return Effect.gen(function* () {
        const moved: CallExecutionControl[] = [];
        let carried = false;
        const settle = (done: boolean) => Effect.forEach(moved, (control) => control.handed?.(done) ?? Effect.void, { discard: true });
        for (const control of resources.values()) {
          if (stopped() || answered) break;
          if (control.background === undefined) continue;
          const answer = yield* control.background();
          if (answer.status === 'unavailable') {
            yield* settle(false);
            return { status: 'unavailable', detail: answer.detail } satisfies CallControlResult;
          }
          moved.push(control);
          if (answer.status === 'carried') carried = true;
        }
        if (stopped()) {
          yield* settle(false);
          return { status: 'unavailable', detail: STOPPED_WHILE_HANDED } satisfies CallControlResult;
        }
        const owed = carried ? Exit.void : yield* Effect.exit(owe());
        if (Exit.isFailure(owed)) {
          yield* settle(false);
          return {
            status: 'unavailable',
            detail: `The invocation stays in the foreground: its outcome could not be recorded as owed to its thread — ${Cause.pretty(owed.cause).split('\n', 1)[0]}`,
          } satisfies CallControlResult;
        }
        const detaching = detach;
        if (detaching === undefined || callEnded(current)) {
          yield* settle(false);
          return { status: 'ended', detail: null } satisfies CallControlResult;
        }
        if (stopped()) {
          yield* settle(false);
          return { status: 'unavailable', detail: STOPPED_WHILE_HANDED } satisfies CallControlResult;
        }
        const unanswered = !answered;
        toBackground();
        releaseEnvelope();
        detaching();
        yield* settle(unanswered);
        return { status: 'changed', detail: null } satisfies CallControlResult;
      }).pipe(
        Effect.tap((answer) =>
          Effect.sync(() => {
            handing = undefined;
            Deferred.doneUnsafe(pending, Effect.succeed(answer));
          }),
        ),
        Effect.uninterruptible,
      );
    });
  const keep = (): Effect.Effect<boolean> =>
    Effect.suspend(() => {
      if (handing !== undefined) return Effect.andThen(Deferred.await(handing), keep());
      if (claim === 'handed' || current.mode === 'background') return Effect.succeed(false);
      taking = undefined;
      if (current.detachable && !callEnded(current)) update({ detachable: false });
      return Effect.succeed(true);
    });
  const handed = (take: Effect.Effect<CallControlResult>): Effect.Effect<CallControlResult> => {
    const pending = Deferred.makeUnsafe<CallControlResult>();
    handing = pending;
    return take.pipe(
      Effect.tap((answer) =>
        Effect.sync(() => {
          handing = undefined;
          Deferred.doneUnsafe(pending, Effect.succeed(answer));
        }),
      ),
      Effect.uninterruptible,
    );
  };
  //! Admission starts the envelope; reader waits and background work do not spend it.
  const armEnvelope = (admission: Admission): void => {
    if (envelopeTimer !== undefined || stopped() || callEnded(current) || current.mode === 'background') return;
    if (current.expiresAt === null) {
      envelopeShows = true;
      update({ expiresAt: admission.at + envelopeMs, expiresBy: 'envelope' });
    }
    envelopeTimer = runCallback(
      Effect.gen(function* () {
        for (;;) {
          const left = envelopeMs - Number(clock.monotonicTimeNanosUnsafe() - admission.clock) / 1_000_000;
          if (left <= 0) {
            stop(envelopeLapsed(envelopeMs), 'timeout');
            return;
          }
          yield* Effect.sleep(left);
        }
      }),
    );
  };
  const releaseEnvelope = (): void => {
    if (envelopeTimer !== undefined) envelopeTimer.interruptUnsafe();
    envelopeTimer = undefined;
    if (!envelopeShows) return;
    envelopeShows = false;
    update({ expiresAt: null, expiresBy: null });
  };
  const admit = <E>(entered: ((at: number) => Effect.Effect<void, E>) | undefined): Effect.Effect<void, E> =>
    Effect.suspend(() => {
      if (admitted !== null || stopped() || callEnded(current)) return Effect.void;
      if (handing !== undefined) return Effect.andThen(Deferred.await(handing), admit(entered));
      const admission = { at: clock.currentTimeMillisUnsafe(), clock: clock.monotonicTimeNanosUnsafe() };
      const entering = Deferred.makeUnsafe<void>();
      admitting = entering;
      return Effect.andThen(
        entered?.(admission.at) ?? Effect.void,
        Effect.sync(() => {
          if (stopped() || callEnded(current)) return;
          admitted = admission;
          canDetach = detach !== undefined;
          update({
            admittedAt: admission.at,
            phase: 'running',
            detail: null,
            detachable: canDetach && current.mode === 'foreground',
          });
          armEnvelope(admission);
        }),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            admitting = undefined;
            Deferred.doneUnsafe(entering, Effect.void);
          }),
        ),
      );
    });
  const finish = (phase: 'completed' | 'failed' | 'stopped' | 'unavailable', detail: string | null = null): void => {
    if (callEnded(current)) return;
    canDetach = false;
    taking = undefined;
    if (timer !== undefined) timer.interruptUnsafe();
    timer = undefined;
    if (envelopeTimer !== undefined) envelopeTimer.interruptUnsafe();
    envelopeTimer = undefined;
    keeping?.interruptUnsafe();
    keeping = undefined;
    detach = undefined;
    fiber = undefined;
    owe = () => Effect.void;
    resources.clear();
    update({ phase, detachable: false, detail: detail ?? current.detail, endedAt: clock.currentTimeMillisUnsafe() });
    Deferred.doneUnsafe(ended, Effect.void);
    if (ownsCost && cost !== null) endCost(cost);
  };
  const makingWay = (): Effect.Effect<never> => Effect.forever(ways.await.pipe(Effect.andThen(ways.close), Effect.andThen(makeWay())));
  const progress: CallProgress = {
    link: (execution, control) => {
      update({ executions: [...current.executions, execution] });
      if (control !== undefined) resources.set(execution, control);
      if (execution.kind === 'command') commands.add(execution);
      if (control?.background !== undefined && current.mode === 'background' && !callEnded(current)) adopt(control);
      const arrival = execution.kind === 'command' ? unread() : null;
      if (arrival !== null) askWay(arrival);
      return () => {
        resources.delete(execution);
        commands.delete(execution);
      };
    },
    stage: (detail) => stage('running', detail),
    watch: () => {
      watches = true;
      const arrival = unread();
      if (arrival !== null) askWay(arrival);
    },
    handOff: () => handOff('agent'),
    stopped: () => cancellation,
    stopping: Deferred.await(halting),
  };
  return {
    get record(): CallRecord {
      return current;
    },
    get stopped(): boolean {
      return stopped();
    },
    get stoppedBy(): CallCancellation | null {
      return cancellation;
    },
    get watching(): boolean {
      return watches;
    },
    settled: Deferred.await(ended),
    moved: Deferred.await(moved),
    stops,
    progress,
    askWay,
    makeWay,
    stage,
    stop,
    declare,
    handOff,
    keep,
    offer: (take: Effect.Effect<CallControlResult>): (() => void) => {
      if (started || callEnded(current) || stopped() || taking !== undefined) return () => {};
      const offered: Effect.Effect<CallControlResult> = Effect.gen(function* () {
        if (claim !== 'none' || callEnded(current)) return { status: 'ended', detail: null } satisfies CallControlResult;
        claim = 'handing';
        const answer = yield* withCost(take);
        if (answer.status === 'changed') {
          claim = 'handed';
          if (taking === offered) taking = undefined;
          return answer;
        }
        claim = 'none';
        if (stopped()) finish('stopped');
        return answer;
      });
      taking = offered;
      update({ detachable: true });
      return () => {
        if (taking !== offered) return;
        taking = undefined;
        if (!callEnded(current) && current.mode === 'foreground') update({ detachable: false });
      };
    },
    limit: Effect.fnUntraced(function* (milliseconds: number, authority: CallAuthority = 'operator'): Effect.fn.Return<CallControlResult> {
      if (callEnded(current)) return { status: 'ended', detail: null };
      const ceiling = current.limitCeilingMs;
      if (ceiling !== null && milliseconds > ceiling) {
        return {
          status: 'unavailable',
          detail: `A foreground invocation is given at most ${envelopeStood(ceiling)} (${ceiling} ms); only one in the background runs longer. Move it to the background, then set the longer limit.`,
        };
      }
      const admission = admitted;
      if (admission === null) {
        return {
          status: 'unavailable',
          detail:
            'The invocation has not been admitted to run yet, and its time is counted from that admission. Set its limit once it runs.',
        };
      }
      const remaining = Math.ceil(milliseconds - Number(clock.monotonicTimeNanosUnsafe() - admission.clock) / 1_000_000);
      if (remaining > 0) {
        for (const control of resources.values()) {
          const answer = yield* control.revise(remaining, authority);
          if (answer.status !== 'changed' && answer.status !== 'ended') return answer;
        }
      }
      if (callEnded(current)) return { status: 'ended', detail: null };
      if (timer !== undefined) timer.interruptUnsafe();
      envelopeShows = false;
      update({ expiresAt: admission.at + milliseconds, expiresBy: 'limit' });
      timer = runCallback(
        Effect.gen(function* () {
          for (;;) {
            const left = milliseconds - Number(clock.monotonicTimeNanosUnsafe() - admission.clock) / 1_000_000;
            if (left <= 0) {
              stop('The invocation time limit expired.', 'timeout');
              return;
            }
            yield* Effect.sleep(left);
          }
        }),
      );
      return { status: 'changed', detail: null };
    }),
    finish,
    withCost,
    prepare: <A, E>(work: Effect.Effect<A, E>, refuse: (reason: string) => E): Effect.Effect<A, E> => {
      const refused = Effect.suspend(() => Effect.fail(refuse(current.detail ?? 'Stopped.')));
      return withCost(
        (stopped() ? refused : Effect.raceFirst(work, Effect.andThen(stops, refused))).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              if (Exit.isSuccess(exit)) stage('waiting');
              else if (!started && claim === 'none') finish(stopped() ? 'stopped' : 'failed');
            }),
          ),
        ),
      );
    },
    attend: <A, E, B>(
      work: Effect.Effect<A, E>,
      hand: (preparing: Effect.Effect<A, E>) => Effect.Effect<CallTaking<B>>,
    ): Effect.Effect<CallAttended<A, B>, E> =>
      withCost(
        Effect.uninterruptibleMask((restore) =>
          Effect.suspend(() => {
            const plain = Effect.map(restore(work), (value): CallAttended<A, B> => ({ handed: false, value }));
            if (started || callEnded(current) || taking !== undefined || current.mode === 'background') return plain;
            const prepared = Deferred.makeUnsafe<A, E>();
            const answer = Deferred.makeUnsafe<CallAttended<A, B>, E>();
            let preparation: Exit.Exit<A, E> | undefined;
            let delivered = false;
            const deliver = (exit: Exit.Exit<A, E>): void => {
              delivered = true;
              Deferred.doneUnsafe(
                answer,
                Exit.map(exit, (value): CallAttended<A, B> => ({ handed: false, value })),
              );
            };
            const leave = (): void => {
              taking = undefined;
              if (!callEnded(current) && current.mode === 'foreground') update({ detachable: false });
            };
            claim = 'none';
            taking = Effect.gen(function* () {
              if (claim !== 'none' || callEnded(current)) return { status: 'ended', detail: null } satisfies CallControlResult;
              claim = 'handing';
              const taken = yield* withCost(hand(Deferred.await(prepared)));
              if ('refused' in taken) {
                claim = 'none';
                const left = preparation;
                if (left !== undefined && !delivered) {
                  if (Exit.isFailure(left)) leave();
                  deliver(left);
                  if (Exit.isFailure(left)) finish(stopped() ? 'stopped' : 'failed');
                } else if (left !== undefined && stopped()) finish('stopped');
                return { status: 'unavailable', detail: taken.refused } satisfies CallControlResult;
              }
              claim = 'handed';
              taking = undefined;
              Deferred.doneUnsafe(answer, Effect.succeed<CallAttended<A, B>>({ handed: true, receipt: taken.receipt }));
              return { status: 'changed', detail: null } satisfies CallControlResult;
            });
            update({ detachable: !stopped() });
            return Effect.gen(function* () {
              const preparing = yield* Effect.forkIn(
                restore(work).pipe(
                  Effect.onExit((exit) =>
                    Effect.sync(() => {
                      preparation = exit;
                      Deferred.doneUnsafe(prepared, exit);
                      if (claim !== 'none') return;
                      if (Exit.isFailure(exit)) leave();
                      deliver(exit);
                    }),
                  ),
                ),
                scope,
                { startImmediately: true },
              );
              const exit = yield* Effect.exit(restore(Deferred.await(answer)));
              if (Exit.isFailure(exit) && claim === 'none') {
                leave();
                preparing.interruptUnsafe();
              }
              return yield* exit;
            });
          }),
        ),
      ),
    run: <A, E, B = A>(options: {
      work: Effect.Effect<A, E>;
      before?: Effect.Effect<Option.Option<A>, E>;
      background: () => B;
      stopped: (reason: string) => Effect.Effect<A, E>;
      completed: (exit: Exit.Exit<A, E>) => Effect.Effect<void>;
      outcome?: (value: A) => 'completed' | 'failed' | 'stopped';
      release?: Effect.Effect<void>;
      entered?: () => void;
      started?: (at: number) => Effect.Effect<void, E>;
      owe?: () => Effect.Effect<void, unknown>;
      detached?: boolean;
      early?: boolean;
      handoff?: CallHandoff;
    }): Effect.Effect<A | B, E> =>
      withCost(
        Effect.uninterruptibleMask(
          Effect.fnUntraced(function* (waiting) {
            if (started || callEnded(current))
              return yield* (options.release ?? Effect.void).pipe(
                Effect.andThen(
                  Effect.die(
                    new Error(
                      `Invocation ${current.runId}/${current.toolCallId} was already admitted or ended; read its existing result instead of executing it again.`,
                    ),
                  ),
                ),
              );
            started = true;
            taking = undefined;
            const owing = options.owe;
            if (owing !== undefined) owe = () => withCost(owing());
            options.entered?.();
            if (scope.state._tag === 'Closed') {
              yield* Effect.exit(options.release ?? Effect.void);
              finish('stopped', 'The runtime that owns this invocation had already closed, so it did not run.');
              return yield* Effect.interrupt;
            }
            if (options.handoff !== undefined) toBackground();
            ahead = options.before !== undefined;
            const result = Deferred.makeUnsafe<A | B, E>();
            const known = Deferred.makeUnsafe<A | B, E>();
            const executing = Effect.uninterruptibleMask(
              Effect.fnUntraced(function* (restore) {
                const proceed = Effect.suspend(() =>
                  stopped()
                    ? Effect.interrupt
                    : admit(options.started).pipe(Effect.andThen(Effect.suspend(() => (stopped() ? Effect.interrupt : options.work)))),
                );
                const before = options.before;
                const body =
                  before === undefined
                    ? proceed
                    : before.pipe(
                        Effect.ensuring(
                          Effect.sync(() => {
                            ahead = false;
                          }),
                        ),
                        Effect.flatMap((answered) => (Option.isSome(answered) ? Effect.succeed(answered.value) : proceed)),
                      );
                const work =
                  options.handoff !== undefined
                    ? agentSpan({
                        type: 'tool-call',
                        runId: record.runId,
                        toolName: record.name,
                        toolCallId: record.toolCallId,
                        executedBy: 'host',
                      })(body).pipe(
                        Effect.updateContext((context: Context.Context<never>) =>
                          options.handoff === 'adopted' || parentSpan === undefined
                            ? Context.omit(Tracer.ParentSpan)(context)
                            : Context.add(context, Tracer.ParentSpan, parentSpan),
                        ),
                      )
                    : body;
                const exit = yield* Effect.exit(stopped() ? Effect.interrupt : restore(work));
                answered = true;
                const resolved = stopped() ? yield* Effect.exit(options.stopped(current.detail ?? 'Stopped.')) : exit;
                yield* Deferred.done(known, resolved);
                const released = yield* Effect.exit(options.release ?? Effect.void);
                const settled = Exit.isFailure(released) ? Exit.failCause(released.cause) : resolved;
                canDetach = false;
                const pending = handing;
                if (pending !== undefined) yield* Deferred.await(pending);
                const detached = current.mode === 'background';
                const delivered = yield* Effect.exit(detached ? options.completed(settled) : Effect.void);
                const answer = Exit.isFailure(delivered) ? Exit.failCause(delivered.cause) : settled;
                finish(
                  Exit.isFailure(released) || Exit.isFailure(delivered)
                    ? 'unavailable'
                    : stopped()
                      ? 'stopped'
                      : Exit.isSuccess(settled)
                        ? (options.outcome?.(settled.value) ?? 'completed')
                        : 'failed',
                  Exit.isFailure(answer) ? Cause.pretty(answer.cause) : null,
                );
                if (!detached) yield* Deferred.done(result, answer);
              }),
            );
            detach = () => {
              Deferred.doneUnsafe(result, Effect.succeed(options.background()));
            };
            if (options.early === true && options.handoff === undefined) {
              canDetach = true;
              update({ detachable: current.mode === 'foreground' && !stopped() });
            }
            const running = yield* Effect.forkIn(executing, scope, { startImmediately: true });
            if (!callEnded(current)) {
              fiber = running;
              keeping = yield* Effect.forkIn(makingWay(), scope, { startImmediately: true });
            }
            if (stopped() && !ahead) running.interruptUnsafe();
            if (options.handoff !== undefined) return options.background();
            if (options.detached === true && !callEnded(current)) {
              const couldDetach = canDetach;
              canDetach = true;
              yield* handOff('agent');
              if (admitted === null) canDetach = couldDetach;
            }
            const runStopped = Effect.flatMap(Deferred.await(halting), (said) =>
              said.reason === 'run-abort' ? Deferred.await(known) : Effect.never,
            );
            const answer = yield* Effect.exit(waiting(Effect.raceFirst(Deferred.await(result), runStopped)));
            if (Exit.isFailure(answer) && Cause.hasInterruptsOnly(answer.cause) && current.mode === 'foreground') {
              stop(RUN_STOPPED, 'run-abort');
            }
            return yield* answer;
          }),
        ),
      ),
  } as const;
};
