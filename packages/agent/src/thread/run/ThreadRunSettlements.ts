import { Context, Effect, Exit, Layer, type Scope } from 'effect';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadRunSettled } from './ThreadRunLedger';

export const ENDING_STAGES_SUBSCRIBER = 'ending stages';

export type ThreadRunSettledSubscriber = {
  readonly name: string;
  readonly handle: (event: ThreadRunSettled) => Effect.Effect<void, ThreadBorderFailed>;
  readonly at?: 'first' | 'after-stages';
};

export type SettlementCursor<E> = {
  readonly delivered: readonly string[];
  readonly entering: (subscriber: string) => Effect.Effect<void, E>;
  readonly done: (subscriber: string) => Effect.Effect<void, E>;
};

export class ThreadRunSettlements extends Context.Service<
  ThreadRunSettlements,
  {
    publish<E>(
      event: ThreadRunSettled,
      cursor: SettlementCursor<E>,
      stages?: Effect.Effect<void, ThreadBorderFailed>,
    ): Effect.Effect<void, ThreadBorderFailed | E>;
    subscribe(subscriber: ThreadRunSettledSubscriber): Effect.Effect<void, never, Scope.Scope>;
  }
>()('@runlith/agent/ThreadRunSettlements') {}

export const threadRunSettlementsLayer: Layer.Layer<ThreadRunSettlements> = Layer.effect(
  ThreadRunSettlements,
  Effect.sync(() => {
    const subscribers: ThreadRunSettledSubscriber[] = [];
    return {
      publish: <E>(event: ThreadRunSettled, cursor: SettlementCursor<E>, stages?: Effect.Effect<void, ThreadBorderFailed>) =>
        Effect.suspend(() => {
          const delivered = new Set(cursor.delivered);
          const step = (name: string, work: Effect.Effect<void, ThreadBorderFailed>) =>
            delivered.has(name) ? Effect.void : cursor.entering(name).pipe(Effect.andThen(work), Effect.andThen(cursor.done(name)));
          const named = (at: ThreadRunSettledSubscriber['at']) =>
            subscribers
              .filter((subscriber) => subscriber.at === at)
              .map((subscriber) => [subscriber.name, subscriber.handle(event)] as const);
          const ordered = [
            ...named('first'),
            ...named(undefined),
            ...(stages === undefined ? [] : [[ENDING_STAGES_SUBSCRIBER, stages] as const]),
            ...named('after-stages'),
          ];
          return Effect.flatMap(
            Effect.forEach(ordered, ([name, work]) => Effect.map(Effect.exit(step(name, work)), (exit) => [name, exit] as const)),
            (exits) => {
              const at = exits.findIndex(([, exit]) => Exit.isFailure(exit));
              if (at < 0) return Effect.void;
              const [name, exit] = exits[at]!;
              const overtaken = exits.slice(at + 1).some(([later]) => !delivered.has(later));
              return overtaken ? Effect.andThen(cursor.entering(name), exit) : exit;
            },
          );
        }),
      subscribe: (subscriber) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            subscribers.push(subscriber);
          }),
          () =>
            Effect.sync(() => {
              const at = subscribers.indexOf(subscriber);
              if (at >= 0) subscribers.splice(at, 1);
            }),
        ),
    };
  }),
);
