import { Clock, Context, Duration, Effect, Fiber, Option } from 'effect';
import { HoldCut, type HoldSite, HoldStalled, LockOrderViolated, ReentrantCall, ResourceInvalid, WaitUnderHold } from './failures.js';
import { keyedGates } from './gates.js';
import { CEILING_CAP, type ExternalCall } from './Held.js';
import { Holding, liveHolds, liveTickets, stall } from './holding.js';

export type SectionDeclaration<K> = {
  readonly name: string;
  readonly owner: string;
  readonly rank: number;
  readonly key: (key: K) => string;
  readonly threshold: Duration.Input;
  readonly ceilings: { readonly hold: Duration.Input; readonly wait: Duration.Input; readonly leaves: string };
  readonly external: ExternalCall;
};

export type Section<K> = {
  readonly declaration: SectionDeclaration<K>;
  enter<A, E, R>(key: K, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldStalled | HoldCut, R>;
  standing(key?: K): ReadonlyArray<{ readonly key: string; readonly holders: number; readonly waiters: number }>;
};

type Occupancy = { readonly site: HoldSite; live: boolean };

export const SectionsHeld = Context.Reference<readonly Occupancy[]>('@runlith/held/SectionsHeld', { defaultValue: () => [] });

const capped = (ms: number): boolean => ms > 0 && ms <= Duration.toMillis(CEILING_CAP);

const invalid = <K>(declaration: SectionDeclaration<K>): string | null => {
  if (!Number.isInteger(declaration.rank) || declaration.rank < 0) return 'its rank is not a whole number';
  if (declaration.ceilings.leaves.trim() === '') return 'it does not state what a cut leaves';
  const holdMs = Duration.toMillis(declaration.ceilings.hold);
  if (!capped(holdMs)) return 'its hold ceiling is not within 15 minutes';
  if (!capped(Duration.toMillis(declaration.ceilings.wait))) return 'its wait ceiling is not within 15 minutes';
  const threshold = Duration.toMillis(declaration.threshold);
  if (!(threshold > 0) || threshold > holdMs) return 'its threshold is not below its hold ceiling';
  return null;
};

export const section = <K>(declaration: SectionDeclaration<K>): Section<K> => {
  const reason = invalid(declaration);
  if (reason !== null) throw new ResourceInvalid({ resource: declaration.name, reason });
  const gates = keyedGates(1);
  const holdMs = Duration.toMillis(declaration.ceilings.hold);
  const waitMs = Duration.toMillis(declaration.ceilings.wait);
  const thresholdMs = Duration.toMillis(declaration.threshold);

  const enter = <A, E, R>(key: K, work: Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldStalled | HoldCut, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const id = declaration.key(key);
        const identity = `${declaration.name}:${id}`;
        const holding = yield* Holding;
        const holds = [
          ...liveHolds(holding).map((token) => `${token.resource}:${token.key}`),
          ...liveTickets(holding).map((ticket) => `ticket:${ticket.phase}`),
        ];
        if (holds.length > 0) return yield* Effect.die(new WaitUnderHold({ waitingOn: identity, holding: holds }));
        const sections = (yield* SectionsHeld).filter((held) => held.live);
        if (sections.some((held) => held.site.resource === declaration.name && held.site.key === id)) {
          return yield* Effect.die(new ReentrantCall({ resource: declaration.name, key: id }));
        }
        const stack = new Error().stack ?? '';
        const blocking = sections.find((held) => held.site.rank >= declaration.rank);
        if (blocking !== undefined) {
          return yield* Effect.die(
            new LockOrderViolated({ wanted: { resource: declaration.name, rank: declaration.rank, key: id, stack }, held: blocking.site }),
          );
        }
        const askedAt = yield* Clock.currentTimeMillis;
        const admitted = gates.tryAdmit(id) ? Option.some(undefined) : yield* restore(gates.admit(id).pipe(Effect.timeoutOption(waitMs)));
        if (Option.isNone(admitted)) {
          const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;
          yield* stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'wait-ceiling', ms: waitedMs });
          return yield* Effect.fail(new HoldStalled({ resource: declaration.name, key: id, outcome: 'none', waitedMs }));
        }
        const heldAt = yield* Clock.currentTimeMillis;
        const occupancy: Occupancy = { site: { resource: declaration.name, rank: declaration.rank, key: id, stack }, live: true };
        const exit = yield* Effect.exit(
          restore(
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.forkScoped(
                  Effect.andThen(
                    Effect.sleep(thresholdMs),
                    stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'hold-threshold', ms: thresholdMs }),
                  ),
                );
                const body = yield* Effect.forkScoped(work.pipe(Effect.provideService(SectionsHeld, [...sections, occupancy])));
                const ended = yield* Effect.timeoutOption(Fiber.join(body), holdMs);
                if (Option.isSome(ended)) return ended.value;
                const heldMs = (yield* Clock.currentTimeMillis) - heldAt;
                yield* stall({ resource: declaration.name, owner: declaration.owner, key: id, kind: 'hold-cut', ms: heldMs });
                return yield* Effect.fail(
                  new HoldCut({ resource: declaration.name, key: id, leaves: declaration.ceilings.leaves, heldMs }),
                );
              }),
            ),
          ),
        );
        occupancy.live = false;
        gates.release(id);
        return yield* exit;
      }),
    );

  return {
    declaration,
    enter,
    standing: (key) => gates.standing(key === undefined ? undefined : declaration.key(key)),
  };
};
