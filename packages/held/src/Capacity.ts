import { Clock, Deferred, Duration, Effect, Exit, Option, type Scope } from 'effect';
import { CapacityBusy, HoldStalled, ResourceInvalid, WaitUnderHold } from './failures.js';
import { Holding, liveHolds, liveTickets, stall, type TicketToken } from './holding.js';

export type TicketClass = 'call' | 'recovery' | 'background';

const RANKS: readonly TicketClass[] = ['recovery', 'call', 'background'];

export type PoolDeclaration = {
  readonly name: string;
  readonly units: number;
  readonly limits: { readonly call: number; readonly background: number };
};

export type Need = { readonly pool: string; readonly units: number };

export type Phase = { readonly name: string; readonly class: TicketClass; readonly needs: readonly Need[] };

export type CapacityCeilings = { readonly admission: Duration.Input; readonly queued: Duration.Input };

export type PoolStanding = {
  readonly pool: string;
  readonly units: number;
  readonly taken: Readonly<Record<TicketClass, number>>;
  readonly queued: number;
};

export type Capacity = {
  ticket<A, E, R>(phase: Phase, use: Effect.Effect<A, E, R>): Effect.Effect<A, E | CapacityBusy | HoldStalled, R>;
  lease(phase: Phase): Effect.Effect<void, CapacityBusy | HoldStalled, Scope.Scope>;
  tryLease(phase: Phase): Effect.Effect<(() => void) | null>;
  standing(): readonly PoolStanding[];
};

type Pool = PoolDeclaration & { readonly taken: Record<TicketClass, number>; heldMs: number };

type Request = { readonly phase: Phase; readonly turn: Deferred.Deferred<void> };

const fits = (pool: Pool, klass: TicketClass, units: number): boolean => {
  const total = pool.taken.call + pool.taken.recovery + pool.taken.background + units;
  if (total > pool.units) return false;
  if (klass === 'recovery') return true;
  if (pool.taken.call + pool.taken.background + units > pool.limits.call) return false;
  return klass === 'call' || pool.taken.background + units <= pool.limits.background;
};

export const capacity = (pools: readonly PoolDeclaration[], ceilings: CapacityCeilings): Capacity => {
  const ledger = new Map<string, Pool>();
  for (const pool of pools) {
    if (
      !(pool.units >= 1) ||
      !(pool.limits.call >= 1) ||
      !(pool.limits.background >= 1) ||
      pool.limits.call > pool.units ||
      pool.limits.background > pool.limits.call
    ) {
      throw new ResourceInvalid({ resource: pool.name, reason: 'its limits are not 1 ≤ background ≤ call ≤ units' });
    }
    ledger.set(pool.name, { ...pool, taken: { call: 0, recovery: 0, background: 0 }, heldMs: 0 });
  }
  const admissionMs = Duration.toMillis(ceilings.admission);
  const queuedMs = Duration.toMillis(ceilings.queued);
  const queue: Request[] = [];

  const poolOf = (need: Need): Pool => {
    const pool = ledger.get(need.pool);
    if (pool === undefined) throw new ResourceInvalid({ resource: need.pool, reason: 'no such pool is declared' });
    return pool;
  };
  const admissible = (phase: Phase): boolean => phase.needs.every((need) => fits(poolOf(need), phase.class, need.units));
  const take = (phase: Phase, sign: 1 | -1): void => {
    for (const need of phase.needs) poolOf(need).taken[phase.class] += sign * need.units;
  };
  const serve = (): void => {
    const blocked = new Set<string>();
    for (const klass of RANKS) {
      for (let at = 0; at < queue.length;) {
        const request = queue[at]!;
        if (request.phase.class !== klass) {
          at += 1;
          continue;
        }
        if (request.phase.needs.some((need) => blocked.has(need.pool)) || !admissible(request.phase)) {
          for (const need of request.phase.needs) blocked.add(need.pool);
          at += 1;
          continue;
        }
        take(request.phase, 1);
        queue.splice(at, 1);
        Deferred.doneUnsafe(request.turn, Exit.void);
      }
    }
  };
  const waitingBefore = (phase: Phase): boolean => {
    const rank = RANKS.indexOf(phase.class);
    return queue.some(
      (request) =>
        RANKS.indexOf(request.phase.class) <= rank &&
        request.phase.needs.some((need) => phase.needs.some((wanted) => wanted.pool === need.pool)),
    );
  };
  const expectedMs = (phase: Phase): number =>
    Math.max(
      0,
      ...phase.needs.map((need) => {
        const pool = poolOf(need);
        const rank = RANKS.indexOf(phase.class);
        const ahead = queue.reduce(
          (sum, request) =>
            RANKS.indexOf(request.phase.class) > rank
              ? sum
              : sum + request.phase.needs.filter((n) => n.pool === need.pool).reduce((s, n) => s + n.units, 0),
          0,
        );
        return ((ahead + need.units) / pool.units) * pool.heldMs;
      }),
    );
  const giveBack = (phase: Phase): void => {
    take(phase, -1);
    serve();
  };
  const settle = (phase: Phase, heldMs: number): void => {
    for (const need of phase.needs) {
      const pool = poolOf(need);
      pool.heldMs = pool.heldMs === 0 ? heldMs : pool.heldMs * 0.8 + heldMs * 0.2;
    }
    giveBack(phase);
  };

  const acquire = Effect.fn('Capacity.acquire')(function* (phase: Phase, kind: 'ticket' | 'lease') {
    const holding = yield* Holding;
    const holds = liveHolds(holding).map((token) => `${token.resource}:${token.key}`);
    const tickets = liveTickets(holding).map((ticket) => `ticket:${ticket.phase}`);
    if (kind === 'ticket' && holds.length > 0)
      return yield* Effect.die(new WaitUnderHold({ waitingOn: `ticket:${phase.name}`, holding: holds }));
    if (!waitingBefore(phase) && admissible(phase)) {
      take(phase, 1);
      return;
    }
    const barred = kind === 'ticket' ? tickets : [...holds, ...tickets];
    if (barred.length > 0) return yield* Effect.die(new WaitUnderHold({ waitingOn: `${kind}:${phase.name}`, holding: barred }));
    const expected = expectedMs(phase);
    if (expected > admissionMs) {
      return yield* Effect.fail(
        new CapacityBusy({ phase: phase.name, pools: phase.needs.map((need) => need.pool), expectedMs: Math.round(expected) }),
      );
    }
    const request: Request = { phase, turn: Deferred.makeUnsafe<void>() };
    queue.push(request);
    const askedAt = yield* Clock.currentTimeMillis;
    const admitted = yield* Deferred.await(request.turn).pipe(
      Effect.timeoutOption(queuedMs),
      Effect.onInterrupt(() => Effect.sync(() => withdraw(request))),
    );
    if (Option.isSome(admitted)) return;
    withdraw(request);
    const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
    const shown = phase.needs.map((need) => need.pool).join(', ');
    yield* stall({ resource: `${kind}:${phase.name}`, owner: phase.class, key: shown, kind: 'wait-ceiling', ms: waitedMs });
    return yield* Effect.fail(new HoldStalled({ resource: phase.name, key: shown, outcome: 'none', waitedMs }));
  });

  const withdraw = (request: Request): void => {
    if (Deferred.isDoneUnsafe(request.turn)) {
      if (!queue.includes(request)) giveBack(request.phase);
      return;
    }
    queue.splice(queue.indexOf(request), 1);
    serve();
  };

  return {
    ticket: <A, E, R>(phase: Phase, use: Effect.Effect<A, E, R>) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          yield* restore(acquire(phase, 'ticket'));
          const startedAt = yield* Clock.currentTimeMillis;
          const ticket: TicketToken = { phase: phase.name, live: true };
          const holding = yield* Holding;
          const exit = yield* Effect.exit(
            restore(use.pipe(Effect.provideService(Holding, { ...holding, tickets: [...holding.tickets, ticket] }))),
          );
          ticket.live = false;
          settle(phase, (yield* Clock.currentTimeMillis) - startedAt);
          return yield* exit;
        }),
      ),
    lease: (phase) =>
      Effect.acquireRelease(
        Effect.flatMap(acquire(phase, 'lease'), () => Clock.currentTimeMillis),
        (startedAt) => Effect.flatMap(Clock.currentTimeMillis, (now) => Effect.sync(() => settle(phase, now - startedAt))),
      ).pipe(Effect.asVoid),
    tryLease: (phase) =>
      Clock.clockWith((clock) =>
        Effect.sync(() => {
          if (waitingBefore(phase) || !admissible(phase)) return null;
          take(phase, 1);
          const startedAt = clock.currentTimeMillisUnsafe();
          let released = false;
          return () => {
            if (released) return;
            released = true;
            settle(phase, clock.currentTimeMillisUnsafe() - startedAt);
          };
        }),
      ),
    standing: () =>
      [...ledger.values()].map((pool) => ({
        pool: pool.name,
        units: pool.units,
        taken: { ...pool.taken },
        queued: queue.filter((request) => request.phase.needs.some((need) => need.pool === pool.name)).length,
      })),
  };
};
