import { Effect, Fiber, FiberSet, Result, type Scope } from 'effect';
import type { RunStatusEnding } from '@runlith/agent/transcript/live';
import type { ChatTakenWords } from '../ChatDraft';
import { ChatConnection, type ChatCommandFailure, type ChatState, type ChatStopped, type ChatThreadView } from '../wire/ChatConnection';
import type { PendingTurns, StatusWatch } from './PendingTurns';

export type StopPhase = 'stopping' | 'requested';

export type WordsReturn = (words: ChatTakenWords) => Effect.Effect<void>;

export type ThreadStopOutcome =
  | { readonly kind: 'repeated' }
  | { readonly kind: 'answered'; readonly stop: ChatStopped }
  | { readonly kind: 'failed'; readonly failure: ChatCommandFailure };

type Stopping = {
  readonly press: object;
  readonly runId: string;
  readonly phase: StopPhase;
  readonly back: WordsReturn | null;
  readonly answered: boolean;
  readonly left: { readonly ending: RunStatusEnding | undefined } | null;
};

export class ThreadStops implements StatusWatch {
  private held = $state.raw<ReadonlyMap<string, Stopping>>(new Map());

  private constructor(
    private readonly connection: ChatConnection<ChatThreadView>,
    private readonly pending: PendingTurns,
    private readonly scope: Scope.Scope,
    private readonly fork: (work: Effect.Effect<void>) => Fiber.Fiber<void>,
  ) {}

  static readonly make = Effect.fnUntraced(function* (
    pending: PendingTurns,
  ): Effect.fn.Return<ThreadStops, never, Scope.Scope | ChatConnection<ChatThreadView>> {
    const fork = yield* FiberSet.makeRuntime<never, void, never>();
    const stops = new ThreadStops(yield* ChatConnection<ChatThreadView>(), pending, yield* Effect.scope, (work) => fork(work));
    pending.track(stops);
    return stops;
  });

  phase(threadId: string, runId: string | null): StopPhase | null {
    const held = this.held.get(threadId);
    return held !== undefined && (held.runId === runId || !held.answered) ? held.phase : null;
  }

  stop(threadId: string, runId: string, back: WordsReturn | null): Effect.Effect<ThreadStopOutcome> {
    return Effect.suspend(() => {
      if (this.phase(threadId, runId) !== null) return Effect.succeed({ kind: 'repeated' } as const);
      const press = {};
      this.put(threadId, { press, runId, phase: 'stopping', back, answered: false, left: null });
      const sent = Effect.flatMap(Effect.result(this.connection.stop(threadId, back !== null)), (result) =>
        this.answered(threadId, press, result),
      );
      return Effect.flatMap(Effect.forkIn(sent, this.scope), Fiber.join);
    });
  }

  forgetReturn(threadId: string): void {
    const held = this.held.get(threadId);
    if (held?.back) this.put(threadId, { ...held, back: null });
  }

  wants(threadId: string): boolean {
    return (this.held.get(threadId)?.back ?? null) !== null;
  }

  observe(threadId: string, state: ChatState<ChatThreadView>): void {
    const held = this.held.get(threadId);
    if (held === undefined || state.status.runId === held.runId) return;
    const ending = state.status.ending;
    if (held.answered || ending?.runId === held.runId) {
      this.end(threadId, held.press);
      this.giveBack(held, held.runId, ending);
      return;
    }
    this.put(threadId, { ...held, left: { ending } });
  }

  private answered(
    threadId: string,
    press: object,
    result: Result.Result<ChatStopped, ChatCommandFailure>,
  ): Effect.Effect<ThreadStopOutcome> {
    return Effect.suspend((): Effect.Effect<ThreadStopOutcome> => {
      const told: ThreadStopOutcome = Result.isFailure(result)
        ? { kind: 'failed', failure: result.failure }
        : { kind: 'answered', stop: result.success };
      const standing = this.held.get(threadId);
      if (standing?.press !== press) return Effect.succeed(told);
      if (Result.isFailure(result) || (result.success.status !== 'stopped' && result.success.status !== 'requested')) {
        this.end(threadId, press);
        return Effect.succeed(told);
      }
      const stop = result.success;
      if (standing.left !== null && standing.left.ending?.runId === stop.runId) {
        this.end(threadId, press);
        this.giveBack(standing, stop.runId, standing.left.ending);
        return Effect.succeed(told);
      }
      const phase = stop.status === 'requested' ? 'requested' : 'stopping';
      this.put(threadId, { ...standing, runId: stop.runId, phase, answered: true, left: null });
      return Effect.as(standing.back === null ? Effect.void : this.pending.follow(threadId), told);
    });
  }

  private giveBack(stopping: Stopping, runId: string, ending: RunStatusEnding | undefined): void {
    if (stopping.back === null || ending?.runId !== runId || ending.status !== 'withdrawn' || ending.words === undefined) return;
    this.fork(stopping.back({ text: ending.words.text, attachments: ending.words.attachments ?? [] }));
  }

  private put(threadId: string, stopping: Stopping): void {
    this.held = new Map(this.held).set(threadId, stopping);
  }

  private end(threadId: string, press: object): void {
    if (this.held.get(threadId)?.press !== press) return;
    const next = new Map(this.held);
    next.delete(threadId);
    this.held = next;
  }
}
