import { Cause, Clock, Duration, Effect, Exit, FiberMap, Option, Schedule, Semaphore } from 'effect';
import type { StoreFailure } from '../platform/contract/service/store.js';
import { Schedules } from './contract/service/schedules.js';
import { type TickRefused, Ticks } from './contract/service/ticks.js';
import type { ScheduleRun, ScheduleState } from './contract/wire/schedule.js';
import { Ledger } from './store/ledger.js';

const AGAIN = Schedule.spaced('10 seconds');

const LONGEST_NAP_MS = 2_000_000_000;

type Identity = { readonly owner: string; readonly name: string };

const keyOf = ({ owner, name }: Identity): string => JSON.stringify([owner, name]);

const compare = (left: Identity, right: Identity): number =>
  left.owner !== right.owner ? (left.owner < right.owner ? -1 : 1) : left.name === right.name ? 0 : left.name < right.name ? -1 : 1;

const reasonOf = (cause: Cause.Cause<TickRefused>): string => {
  const refused = Cause.findErrorOption(cause);
  return Option.isSome(refused) ? refused.value.reason : `the receiver failed: ${Cause.pretty(cause)}`;
};

export const makeTimetable = Effect.gen(function* () {
  const ledger = yield* Ledger;
  const ticks = yield* Ticks;
  const runs = yield* FiberMap.make<string, void, StoreFailure>();
  const declaring = yield* Semaphore.make(1);

  const states = new Map<string, ScheduleState>();

  let ordered: Identity[] = [];

  const owners = new Map<string, Set<string>>();

  const read: Schedules['Service']['read'] = ({ after, limit }) =>
    Effect.sync(() => {
      const start = after === null ? 0 : upperBound(after);
      const rows = ordered.slice(start, start + limit).flatMap((identity) => {
        const state = states.get(keyOf(identity));
        return state === undefined ? [] : [state];
      });
      return { rows, total: ordered.length, more: start + limit < ordered.length };
    });

  const declare: Schedules['Service']['declare'] = Effect.fn('Schedules.declare')(function* (owner, cadences) {
    const wanted = new Map(cadences.map((cadence) => [cadence.name, cadence]));
    for (const name of wanted.keys()) {
      const key = keyOf({ owner, name });
      if (!states.has(key)) yield* FiberMap.remove(runs, key);
    }
    const stored = new Map((yield* ledger.of(owner)).map((state) => [state.name, state]));
    for (const name of owners.get(owner) ?? []) {
      const cadence = wanted.get(name);
      const state = states.get(keyOf({ owner, name }));
      if (state !== undefined && (cadence === undefined || cadence.everyMs !== state.everyMs)) {
        yield* FiberMap.remove(runs, keyOf({ owner, name }));
      }
    }
    const now = yield* Clock.currentTimeMillis;
    const fresh: ScheduleState[] = [];
    const started: string[] = [];
    for (const cadence of wanted.values()) {
      const key = keyOf({ owner, name: cadence.name });
      const before = states.get(key) ?? stored.get(cadence.name);
      if (before !== undefined && before.everyMs === cadence.everyMs) {
        if (!(yield* FiberMap.has(runs, key))) started.push(key);
        keep(before);
      } else {
        fresh.push({
          owner,
          name: cadence.name,
          everyMs: cadence.everyMs,
          nextAt: now + cadence.everyMs,
          running: false,
          last: before?.last ?? null,
        });
      }
    }
    yield* ledger.replace(
      owner,
      [...wanted.keys()],
      fresh.map(({ name, everyMs, nextAt }) => ({ name, everyMs, nextAt })),
    );
    dropAbsent(owner, new Set(wanted.keys()));
    for (const state of fresh) {
      keep(state);
      started.push(keyOf(state));
    }
    for (const key of started) yield* FiberMap.run(runs, key, follow(key));
  }, declaring.withPermit);

  const withdraw = (owner: string): void => {
    for (const name of owners.get(owner) ?? []) {
      const fiber = FiberMap.getUnsafe(runs, keyOf({ owner, name }));
      if (Option.isSome(fiber)) fiber.value.interruptUnsafe();
    }
    dropAbsent(owner, new Set());
  };

  const keep = (state: ScheduleState): void => {
    states.set(keyOf(state), state);
    const names = owners.get(state.owner) ?? new Set<string>();
    names.add(state.name);
    owners.set(state.owner, names);
    const at = lowerBound(state);
    if (ordered[at] === undefined || compare(ordered[at], state) !== 0) ordered.splice(at, 0, { owner: state.owner, name: state.name });
  };

  const dropAbsent = (owner: string, wanted: ReadonlySet<string>): void => {
    const names = owners.get(owner);
    if (names === undefined) return;
    let dropped = false;
    for (const name of names) {
      if (wanted.has(name)) continue;
      states.delete(keyOf({ owner, name }));
      names.delete(name);
      dropped = true;
    }
    if (names.size === 0) owners.delete(owner);
    if (dropped) ordered = ordered.filter((identity) => identity.owner !== owner || wanted.has(identity.name));
  };

  const lowerBound = (target: Identity): number => {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (compare(ordered[middle]!, target) < 0) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  const upperBound = (target: Identity): number => {
    const at = lowerBound(target);
    return ordered[at] !== undefined && compare(ordered[at], target) === 0 ? at + 1 : at;
  };

  const follow = Effect.fnUntraced(function* (key: string): Effect.fn.Return<void, StoreFailure> {
    while (true) {
      const state = states.get(key);
      if (state === undefined) return;
      const now = yield* Clock.currentTimeMillis;
      if (state.nextAt > now) yield* Effect.sleep(Duration.millis(Math.min(state.nextAt - now, LONGEST_NAP_MS)));
      else yield* run(key, state, now);
    }
  });

  const run = Effect.fn('Schedules.run')(function* (
    key: string,
    state: ScheduleState,
    startedAt: number,
  ): Effect.fn.Return<void, StoreFailure> {
    states.set(key, { ...state, running: true });
    const exit = yield* Effect.exit(
      ticks.deliver({
        owner: state.owner,
        name: state.name,
        scheduledAt: state.nextAt,
        startedAt,
        skipped: Math.floor((startedAt - state.nextAt) / state.everyMs),
      }),
    );
    if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.interrupt;
    const endedAt = yield* Clock.currentTimeMillis;
    const slots = Math.floor((endedAt - state.nextAt) / state.everyMs) + 1;
    const last: ScheduleRun = {
      startedAt,
      endedAt,
      outcome: Exit.isSuccess(exit) ? 'delivered' : 'failed',
      reason: Exit.isSuccess(exit) ? null : reasonOf(exit.cause),
      skipped: slots - 1,
    };
    const nextAt = state.nextAt + slots * state.everyMs;
    states.set(key, { ...state, nextAt, running: false, last });
    yield* ledger.ended(state.owner, state.name, nextAt, last).pipe(
      Effect.tapError((failure) => Effect.logError(`schedule ${key} could not record its run and tries again`, failure)),
      Effect.retry(AGAIN),
    );
  });

  return { ...Schedules.of({ read, declare }), withdraw };
});
