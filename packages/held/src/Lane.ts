import { Clock, Deferred, Duration, Effect, Fiber, Option, type Scope } from 'effect';
import { type HoldCut, HoldStalled, ReentrantCall, WaitUnderHold } from './failures.js';
import { declare, type ExternalCall } from './Held.js';
import { Holding, liveHolds, liveTickets, Origin, stall } from './holding.js';

export type LaneDeclaration = {
  readonly name: string;
  readonly owner: string;
  readonly rank: number;
  readonly threshold: Duration.Input;
  readonly ceilings: { readonly step: Duration.Input; readonly wait: Duration.Input; readonly leaves: string };
  readonly external: ExternalCall;
};

export type Position = { readonly lane: string; readonly at: number };

export type Lane = {
  readonly declaration: LaneDeclaration;
  position(): Position;
  enter<A, E>(key: string, step: Effect.Effect<A, E>, position?: Position): Effect.Effect<A, E | HoldStalled | HoldCut | ReentrantCall>;
  standing(): ReadonlyArray<{ readonly key: string; readonly busy: boolean; readonly waiting: number }>;
};

type Entry = { readonly at: number; readonly go: Deferred.Deferred<void> };
type Queue = { busy: boolean; readonly ready: Entry[] };

export const lane = Effect.fnUntraced(function* (declaration: LaneDeclaration): Effect.fn.Return<Lane, never, Scope.Scope> {
  const section = declare<string>({
    name: declaration.name,
    owner: declaration.owner,
    rank: declaration.rank,
    key: (key) => key,
    concurrency: 1,
    threshold: declaration.threshold,
    ceilings: { hold: declaration.ceilings.step, wait: declaration.ceilings.step, leaves: declaration.ceilings.leaves },
    external: declaration.external,
  });
  const waitMs = Duration.toMillis(declaration.ceilings.wait);
  const scope = yield* Effect.scope;
  const queues = new Map<string, Queue>();
  let arrivals = 0;

  const pump = (key: string, queue: Queue): void => {
    if (queue.busy) return;
    const next = queue.ready.shift();
    if (next === undefined) {
      queues.delete(key);
      return;
    }
    queue.busy = true;
    Deferred.doneUnsafe(next.go, Effect.void);
  };

  const leave = (key: string, queue: Queue, entry: Entry): void => {
    const at = queue.ready.indexOf(entry);
    if (at !== -1) queue.ready.splice(at, 1);
    if (!queue.busy && queue.ready.length === 0) queues.delete(key);
  };

  const position = (): Position => ({ lane: declaration.name, at: (arrivals += 1) });

  const enter = <A, E>(
    key: string,
    step: Effect.Effect<A, E>,
    kept?: Position,
  ): Effect.Effect<A, E | HoldStalled | HoldCut | ReentrantCall> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const identity = `${declaration.name}:${key}`;
        const holding = yield* Holding;
        if ((yield* Origin).has(identity) || holding.within.includes(identity)) {
          return yield* Effect.fail(new ReentrantCall({ resource: declaration.name, key }));
        }
        const holds = [
          ...liveHolds(holding).map((token) => `${token.resource}:${token.key}`),
          ...liveTickets(holding).map((ticket) => `ticket:${ticket.phase}`),
        ];
        if (holds.length > 0) return yield* Effect.die(new WaitUnderHold({ waitingOn: identity, holding: holds }));
        const at = kept !== undefined && kept.lane === declaration.name ? kept.at : position().at;
        let queue = queues.get(key);
        if (queue === undefined) {
          queue = { busy: false, ready: [] };
          queues.set(key, queue);
        }
        const entry: Entry = { at, go: Deferred.makeUnsafe<void>() };
        const before = queue.ready.findIndex((other) => other.at > at);
        queue.ready.splice(before === -1 ? queue.ready.length : before, 0, entry);
        const standing = queue;
        const askedAt = yield* Clock.currentTimeMillis;
        pump(key, standing);
        const admitted = yield* restore(Deferred.await(entry.go).pipe(Effect.timeoutOption(waitMs))).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              if (Deferred.isDoneUnsafe(entry.go)) {
                standing.busy = false;
                pump(key, standing);
              } else leave(key, standing, entry);
            }),
          ),
        );
        if (Option.isNone(admitted)) {
          if (Deferred.isDoneUnsafe(entry.go)) {
            standing.busy = false;
            pump(key, standing);
          } else leave(key, standing, entry);
          const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
          yield* stall({ resource: declaration.name, owner: declaration.owner, key, kind: 'wait-ceiling', ms: waitedMs });
          return yield* Effect.fail(new HoldStalled({ resource: declaration.name, key, outcome: 'none', waitedMs }));
        }
        const running = yield* Effect.forkIn(
          section.hold(key, step).pipe(
            Effect.interruptible,
            Effect.provideService(Holding, { tokens: [], tickets: [], within: [...holding.within, identity] }),
            Effect.ensuring(
              Effect.sync(() => {
                standing.busy = false;
                pump(key, standing);
              }),
            ),
          ),
          scope,
        );
        return yield* restore(Fiber.join(running));
      }),
    );

  return {
    declaration,
    position,
    enter,
    standing: () => [...queues].map(([key, queue]) => ({ key, busy: queue.busy, waiting: queue.ready.length })),
  };
});
