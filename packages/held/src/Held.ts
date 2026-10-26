import { Clock, Context, Duration, Effect, Fiber, Option, type Scope } from 'effect';
import { HoldCut, HoldStalled, LockOrderViolated, ResourceInvalid } from './failures.js';
import { keyedGates } from './gates.js';
import { HeldFor, Holding, type HoldToken, liveHolds, stall } from './holding.js';

export const CEILING_CAP = Duration.minutes(15);

export type ExternalCall = 'none' | { readonly named: string; readonly callsBack: boolean };

export type SizedCeiling<K> = { readonly base: Duration.Input; readonly bySize: (size: number, keys: readonly K[]) => Duration.Input };

type Resource<K> = {
  readonly name: string;
  readonly owner: string;
  readonly rank: number;
  readonly key: (key: K) => string;
  readonly concurrency: number;
  readonly threshold: Duration.Input;
  readonly external: ExternalCall;
};

export type ResourceDeclaration<K, C extends Duration.Input | SizedCeiling<K> = Duration.Input> = Resource<K> & {
  readonly ceilings: { readonly hold: C; readonly wait: Duration.Input; readonly leaves: string };
};

export type UncutDeclaration<K> = Resource<K> & { readonly ceilings: 'none' };

type Standing = ReadonlyArray<{ readonly key: string; readonly holders: number; readonly waiters: number }>;

export type Holder = { readonly heldFor: string | null; readonly since: number };

export type Held<K, F = HoldStalled | HoldCut> = {
  readonly declaration: ResourceDeclaration<K> | UncutDeclaration<K>;
  hold<A, E, R>(key: K, use: Effect.Effect<A, E, R>): Effect.Effect<A, E | F, R>;
  holdAll<A, E, R>(keys: readonly K[], use: Effect.Effect<A, E, R>): Effect.Effect<A, E | F, R>;
  lease(key: K): Effect.Effect<() => void, Extract<F, HoldStalled>, Scope.Scope>;
  standing(key?: K): Standing;
  holders(key: K): ReadonlyArray<Holder>;
};

export type SizedHeld<K> = {
  readonly declaration: ResourceDeclaration<K, SizedCeiling<K>>;
  hold<A, E, R>(key: K, size: number, use: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldStalled | HoldCut, R>;
  holdAll<A, E, R>(keys: readonly K[], size: number, use: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldStalled | HoldCut, R>;
  lease(key: K): Effect.Effect<() => void, HoldStalled, Scope.Scope>;
  standing(key?: K): Standing;
  holders(key: K): ReadonlyArray<Holder>;
};

const monotonicMillis = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos) / 1_000_000);

const sized = <K>(ceiling: Duration.Input | SizedCeiling<K>): ceiling is SizedCeiling<K> =>
  typeof ceiling === 'object' && ceiling !== null && 'bySize' in ceiling && typeof ceiling.bySize === 'function';

const within = (ms: number): boolean => ms > 0 && ms <= Duration.toMillis(CEILING_CAP);

type Declared<K> = ResourceDeclaration<K, Duration.Input | SizedCeiling<K>> | UncutDeclaration<K>;

const invalid = <K>(declaration: Declared<K>): string | null => {
  if (!Number.isInteger(declaration.rank) || declaration.rank < 0) return 'its rank is not a whole number';
  if (!Number.isInteger(declaration.concurrency) || declaration.concurrency < 1) return 'its concurrency is below one';
  const threshold = Duration.toMillis(declaration.threshold);
  if (declaration.ceilings === 'none') return threshold > 0 ? null : 'its threshold is not above zero';
  if (declaration.ceilings.leaves.trim() === '') return 'it does not state what a cut leaves';
  const hold = declaration.ceilings.hold;
  const holdMs = Duration.toMillis(sized(hold) ? hold.base : hold);
  if (!within(holdMs)) return sized(hold) ? 'its hold base is not within 15 minutes' : 'its hold ceiling is not within 15 minutes';
  if (!within(Duration.toMillis(declaration.ceilings.wait))) return 'its wait ceiling is not within 15 minutes';
  if (!(threshold > 0) || threshold > holdMs) return 'its threshold is not below its hold ceiling';
  return null;
};

export function declare<K>(declaration: ResourceDeclaration<K, SizedCeiling<K>>): SizedHeld<K>;
export function declare<K>(declaration: UncutDeclaration<K>): Held<K, never>;
export function declare<K>(declaration: ResourceDeclaration<K>): Held<K>;
export function declare<K>(declaration: Declared<K>): Held<K> | Held<K, never> | SizedHeld<K> {
  const reason = invalid(declaration);
  if (reason !== null) throw new ResourceInvalid({ resource: declaration.name, reason });
  const ceilings = declaration.ceilings === 'none' ? null : declaration.ceilings;
  const gates = keyedGates(declaration.concurrency);
  const waitMs = ceilings === null ? null : Duration.toMillis(ceilings.wait);
  const thresholdMs = Duration.toMillis(declaration.threshold);
  const live = new Map<string, Set<HoldToken>>();
  const enlist = (token: HoldToken): void => {
    const held = live.get(token.key) ?? new Set<HoldToken>();
    held.add(token);
    live.set(token.key, held);
  };
  const discharge = (token: HoldToken): void => {
    const held = live.get(token.key);
    if (held === undefined) return;
    held.delete(token);
    if (held.size === 0) live.delete(token.key);
  };
  const holders = (key: K): ReadonlyArray<Holder> =>
    [...(live.get(declaration.key(key)) ?? [])].map((token) => ({ heldFor: token.heldFor, since: token.since }));

  const admitted = (waiting: Effect.Effect<void>): Effect.Effect<Option.Option<void>> =>
    waitMs === null ? Effect.asSome(waiting) : Effect.timeoutOption(waiting, waitMs);

  const holdAll = <A, E, R>(
    keys: readonly K[],
    holdMs: number | null,
    use: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HoldStalled | HoldCut, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const ids = [...new Set(keys.map(declaration.key))].sort();
        const shown = ids.join(', ');
        const stack = new Error().stack ?? '';
        const holding = yield* Holding;
        const blocking = liveHolds(holding).find((token) => token.rank >= declaration.rank);
        if (blocking !== undefined) {
          return yield* Effect.die(
            new LockOrderViolated({ wanted: { resource: declaration.name, rank: declaration.rank, key: shown, stack }, held: blocking }),
          );
        }
        const taken: string[] = [];
        for (const id of ids) {
          if (!gates.tryAdmit(id)) break;
          taken.push(id);
        }
        const waiting = taken.length === ids.length ? ids.slice(0, 0) : ids.slice(taken.length);
        const askedAt = waiting.length === 0 ? 0 : yield* Clock.currentTimeMillis;
        const entered =
          waiting.length === 0
            ? Option.some(undefined)
            : yield* restore(
                admitted(Effect.forEach(waiting, (id) => Effect.map(gates.admit(id), () => void taken.push(id)), { discard: true })),
              ).pipe(Effect.onInterrupt(() => Effect.sync(() => taken.forEach(gates.release))));
        if (Option.isNone(entered)) {
          taken.forEach(gates.release);
          const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
          yield* stall({ resource: declaration.name, owner: declaration.owner, key: shown, kind: 'wait-ceiling', ms: waitedMs });
          return yield* Effect.fail(new HoldStalled({ resource: declaration.name, key: shown, outcome: 'none', waitedMs }));
        }
        const since = yield* monotonicMillis;
        const heldFor = yield* HeldFor;
        const tokens: HoldToken[] = ids.map((key) => ({
          resource: declaration.name,
          rank: declaration.rank,
          key,
          stack,
          since,
          heldFor,
          live: true,
        }));
        tokens.forEach(enlist);
        const heldAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(
          restore(
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.forkScoped(
                  Effect.andThen(
                    Effect.sleep(thresholdMs),
                    stall({ resource: declaration.name, owner: declaration.owner, key: shown, kind: 'hold-threshold', ms: thresholdMs }),
                  ),
                );
                const body = yield* Effect.forkScoped(
                  use.pipe(Effect.provideService(Holding, { ...holding, tokens: [...holding.tokens, ...tokens] })),
                );
                if (holdMs === null || ceilings === null) return yield* Fiber.join(body);
                const ended = yield* Effect.timeoutOption(Fiber.join(body), holdMs);
                if (Option.isSome(ended)) return ended.value;
                const heldMs = (yield* Clock.currentTimeMillis) - heldAt;
                yield* stall({ resource: declaration.name, owner: declaration.owner, key: shown, kind: 'hold-cut', ms: heldMs });
                return yield* Effect.fail(new HoldCut({ resource: declaration.name, key: shown, leaves: ceilings.leaves, heldMs }));
              }),
            ),
          ),
        );
        for (const token of tokens) {
          token.live = false;
          discharge(token);
        }
        ids.forEach(gates.release);
        return yield* exit;
      }),
    );

  const lease = (key: K): Effect.Effect<() => void, HoldStalled, Scope.Scope> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = declaration.key(key);
        const stack = new Error().stack ?? '';
        const holding = yield* Holding;
        const blocking = liveHolds(holding).find((token) => token.rank >= declaration.rank);
        if (blocking !== undefined) {
          return yield* Effect.die(
            new LockOrderViolated({ wanted: { resource: declaration.name, rank: declaration.rank, key: id, stack }, held: blocking }),
          );
        }
        const askedAt = yield* Clock.currentTimeMillis;
        const entered = gates.tryAdmit(id) ? Option.some(undefined) : yield* restore(admitted(gates.admit(id)));
        if (Option.isNone(entered)) {
          const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
          yield* stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'wait-ceiling', ms: waitedMs });
          return yield* Effect.fail(new HoldStalled({ resource: declaration.name, key: id, outcome: 'none', waitedMs }));
        }
        const owner = Fiber.getCurrent()!;
        const token: HoldToken = {
          resource: declaration.name,
          rank: declaration.rank,
          key: id,
          stack,
          since: yield* monotonicMillis,
          heldFor: yield* HeldFor,
          live: true,
        };
        enlist(token);
        owner.setContext(Context.add(owner.context, Holding, { ...holding, tokens: [...holding.tokens, token] }));
        const release = () => {
          if (!token.live) return;
          token.live = false;
          discharge(token);
          const current = owner.getRef(Holding);
          owner.setContext(Context.add(owner.context, Holding, { ...current, tokens: current.tokens.filter((held) => held !== token) }));
          gates.release(id);
        };
        yield* Effect.addFinalizer(() => Effect.sync(release));
        yield* Effect.forkScoped(
          Effect.andThen(
            Effect.sleep(thresholdMs),
            Effect.suspend(() =>
              token.live
                ? stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'hold-threshold', ms: thresholdMs })
                : Effect.void,
            ),
          ),
        );
        return release;
      }),
    );

  const standing = (key?: K): Standing => gates.standing(key === undefined ? undefined : declaration.key(key));

  if (ceilings === null) {
    const uncut: Held<K, never> = {
      declaration: declaration as UncutDeclaration<K>,
      hold: <A, E, R>(key: K, use: Effect.Effect<A, E, R>) => holdAll([key], null, use) as Effect.Effect<A, E, R>,
      holdAll: <A, E, R>(keys: readonly K[], use: Effect.Effect<A, E, R>) => holdAll(keys, null, use) as Effect.Effect<A, E, R>,
      lease: (key) => lease(key) as Effect.Effect<() => void, never, Scope.Scope>,
      standing,
      holders,
    };
    return uncut;
  }

  const ceiling = ceilings.hold;
  if (!sized(ceiling)) {
    const holdMs = Duration.toMillis(ceiling);
    const fixed: Held<K> = {
      declaration: declaration as ResourceDeclaration<K>,
      hold: (key, use) => holdAll([key], holdMs, use),
      holdAll: (keys, use) => holdAll(keys, holdMs, use),
      lease,
      standing,
      holders,
    };
    return fixed;
  }

  const baseMs = Duration.toMillis(ceiling.base);
  const sizedAll = <A, E, R>(
    keys: readonly K[],
    size: number,
    use: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HoldStalled | HoldCut, R> =>
    Effect.suspend(() => {
      if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
        return Effect.die(
          new ResourceInvalid({
            resource: declaration.name,
            reason: `its hold was asked without a finite nonnegative size (${String(size)})`,
          }),
        );
      }
      const growsMs = Duration.toMillis(ceiling.bySize(size, keys));
      const holdMs = baseMs + growsMs;
      if (!(growsMs >= 0) || !within(holdMs)) {
        return Effect.die(
          new ResourceInvalid({ resource: declaration.name, reason: `its hold ceiling for size ${size} is not within 15 minutes` }),
        );
      }
      return holdAll(keys, holdMs, use);
    });

  const bySize: SizedHeld<K> = {
    declaration: declaration as ResourceDeclaration<K, SizedCeiling<K>>,
    hold: (key, size, use) => sizedAll([key], size, use),
    holdAll: sizedAll,
    lease,
    standing,
    holders,
  };
  return bySize;
}
