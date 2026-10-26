import { basename, dirname } from 'node:path';
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberSet,
  Layer,
  Schedule,
  Scope,
  Semaphore,
  Stream,
  Tracer,
} from 'effect';
import { type Adapter, type Engine, EngineDisabled, EngineFailed, EngineLost, Engines } from '@runlith/navigation/adapter';
import { type Checkout, CheckoutRefused, Launcher, type Process, type Touch } from '@runlith/navigation/engine';
import { type Machine, thisMachine } from '../platform/contract/service/capacity.js';
import { drive } from '../platform/contract/service/drives.js';
import { CheckoutRows } from '../workspace/contract/service/checkouts.js';
import { FileRoots } from '../workspace/contract/service/roots.js';
import { CheckoutWatch, type CheckoutShift, type Following } from '../workspace/contract/service/watch.js';
import type { RootId } from '../workspace/contract/wire/ids.js';
import type { FileRoot } from '../workspace/contract/wire/roots.js';
import { budgetOf, shareOf } from './budget.js';
import { EngineStates, QueryProject } from './contract/service/engines.js';
import type { EngineBudget, EnginePhase, EngineRow } from './contract/wire/engines.js';
import { Settings } from '../settings/contract/service/values.js';
import { SettingChanges } from '../settings/contract/service/changes.js';
import { CheckoutPaths } from '../workspace/contract/service/checkoutPaths.js';
import { navigationEnabled } from './contract/wire/settings.js';

const IDLE = Duration.minutes(15);
const SWEEP = Duration.seconds(30);
const STEADY = Duration.seconds(30);
const REST_FLOOR = Duration.seconds(1);
const REST_CEILING = Duration.minutes(1);
const REPEATED = 3;

type Joined =
  | { readonly _tag: 'apart' }
  | { readonly _tag: 'joining'; readonly generation: number; readonly settled: Deferred.Deferred<void> }
  | { readonly _tag: 'joined'; readonly generation: number; readonly scope: Scope.Closeable; readonly checkout: Checkout }
  | { readonly _tag: 'failed'; readonly generation: number; readonly detail: string };

type Policy = { readonly projectId: number; readonly enabled: () => boolean };

type Seat = {
  readonly rootId: RootId;
  readonly policies: Map<number, Policy>;
  root: string;
  leases: number;
  questions: number;
  lastUse: number;
  joined: Joined;
  rested: boolean;
};

type Running = {
  readonly _tag: 'running';
  readonly scope: Scope.Closeable;
  readonly process: Process;
  readonly permits: Semaphore.Semaphore;
  readonly lost: Deferred.Deferred<never, EngineLost>;
  readonly gone: Deferred.Deferred<string | null>;
  readonly closed: Deferred.Deferred<void>;
  readonly since: number;
  memory: number | null;
};

type Phase =
  | { readonly _tag: 'idle' }
  | { readonly _tag: 'waiting'; readonly settled: Deferred.Deferred<void> }
  | { readonly _tag: 'starting'; readonly settled: Deferred.Deferred<void> }
  | Running
  | { readonly _tag: 'ending'; readonly closed: Deferred.Deferred<void> }
  | { readonly _tag: 'resting'; readonly detail: string; readonly until: number };

type Slot = {
  readonly key: string;
  readonly seats: Map<RootId, Seat>;
  base: Seat | null;
  phase: Phase;
  generation: number;
  failures: number;
  failure: string | null;
  start: Fiber.Fiber<void> | null;
};

type Placed = { readonly slot: Slot; readonly seat: Seat; readonly root: FileRoot; readonly policy: Policy };

const APART: Joined = { _tag: 'apart' };

const RESCAN: Touch = { _tag: 'rescan' };

const HEAD: Touch = { _tag: 'head' };

const WORKTREES = 'worktrees';

const touchOf = (shift: CheckoutShift): Touch | null =>
  shift.rescan !== null ? RESCAN : shift.paths.size === 0 ? null : { _tag: 'paths', paths: [...shift.paths.keys()] };

const detached = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  Effect.updateContext(effect, (context: Context.Context<never>) => Context.omit(Tracer.ParentSpan)(context));

const seatOf = (rootId: RootId, root: string, now: number, policy: Policy): Seat => ({
  rootId,
  root,
  policies: new Map([[policy.projectId, policy]]),
  leases: 0,
  questions: 0,
  lastUse: now,
  joined: APART,
  rested: false,
});

const lastOf = (slot: Slot): number => Math.max(0, ...[...slot.seats.values()].map((seat) => seat.lastUse));

const free = (seat: Seat): boolean => seat.leases === 0 && seat.questions === 0;

const allowed = (seat: Seat): boolean => [...seat.policies.values()].some((policy) => policy.enabled());

const busy = (slot: Slot): boolean => [...slot.seats.values()].some((seat) => allowed(seat) && !free(seat));

export const makeHolder = Effect.fnUntraced(function* (input: { readonly machine: Machine }) {
  const launcher = yield* Launcher;
  const watch = yield* CheckoutWatch;
  const rows = yield* CheckoutRows;
  const roots = yield* FileRoots;
  const paths = yield* CheckoutPaths;
  const settings = yield* Settings;
  const changes = yield* SettingChanges;
  const scope = yield* Effect.scope;
  const fibers = yield* FiberSet.make();
  const gate = yield* Semaphore.make(1);
  const budget = budgetOf(input.machine);
  const slots = new Map<string, Slot>();
  let freed = yield* Deferred.make<void>();

  const stir = Effect.suspend(() => {
    const was = freed;
    freed = Deferred.makeUnsafe<void>();
    return Deferred.succeed(was, undefined);
  });

  const used = (seat: Seat) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.andThen(
        Effect.sync(() => {
          seat.lastUse = now;
        }),
        stir,
      ),
    );

  const running = (slot: Slot): Running | null => (slot.phase._tag === 'running' ? slot.phase : null);

  const runningAll = () =>
    [...slots.values()].flatMap((slot) => {
      const phase = running(slot);
      return phase === null ? [] : [{ slot, phase }];
    });

  const rest = (failures: number): number =>
    Math.min(Duration.toMillis(REST_CEILING), Duration.toMillis(REST_FLOOR) * 2 ** Math.max(0, failures - 1));

  const queued = (seat: Seat, phase: Running, adapter: Adapter): Adapter => {
    const ask = <A>(work: Effect.Effect<A, EngineLost>): Effect.Effect<A, EngineLost> =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          seat.questions += 1;
        }),
        () => Effect.raceFirst(Semaphore.withPermit(phase.permits, work), Deferred.await(phase.lost)),
        () =>
          Effect.andThen(
            Effect.sync(() => {
              seat.questions -= 1;
            }),
            used(seat),
          ),
      );
    return {
      locate: (spot) => ask(adapter.locate(spot)).pipe(Effect.withSpan('Engines.locate')),
      judge: (judging) => ask(adapter.judge(judging)).pipe(Effect.withSpan('Engines.judge')),
    };
  };

  const signal = (phase: Running) => (lost: EngineLost) => Deferred.succeed(phase.gone, lost.detail);

  const spread = Effect.suspend(() => {
    const live = runningAll();
    const share = shareOf(budget, live.length);
    return Effect.forEach(live, ({ phase }) => phase.process.limit(share).pipe(Effect.catchTag('EngineLost', signal(phase))), {
      discard: true,
    });
  });

  const settle = Effect.fn('Engines.settle')(function* (slot: Slot, generation: number, phase: Running, detail: string | null) {
    slot.phase = { _tag: 'ending', closed: phase.closed };
    yield* Deferred.fail(phase.lost, new EngineLost({ detail: detail ?? 'the engine was stopped to free the machine for others' }));
    yield* Scope.close(phase.scope, Exit.void);
    for (const seat of slot.seats.values()) if (seat.joined._tag !== 'apart' && seat.joined.generation === generation) seat.joined = APART;
    const now = yield* Clock.currentTimeMillis;
    if (slot.generation === generation) {
      if (now - phase.since >= Duration.toMillis(STEADY)) slot.failures = 0;
      if (detail === null) slot.phase = { _tag: 'idle' };
      else {
        slot.failures += 1;
        slot.failure = detail;
        slot.phase = { _tag: 'resting', detail, until: now + rest(slot.failures) };
      }
    }
    yield* Deferred.succeed(phase.closed, undefined);
    yield* stir;
    yield* spread;
  });

  const guard = (slot: Slot, generation: number, phase: Running) =>
    Effect.flatMap(Effect.raceFirst(phase.process.ended, Deferred.await(phase.gone)), (detail) => settle(slot, generation, phase, detail));

  const stop = (slot: Slot, idle: boolean): Effect.Effect<void> => {
    const phase = running(slot);
    if (phase === null || (idle && busy(slot))) return Effect.void;
    slot.phase = { _tag: 'ending', closed: phase.closed };
    return Effect.andThen(Deferred.succeed(phase.gone, null), Deferred.await(phase.closed));
  };

  const part = (seat: Seat): Effect.Effect<void> => {
    const joined = seat.joined;
    if (joined._tag !== 'joined') return Effect.void;
    seat.joined = APART;
    return Scope.close(joined.scope, Exit.void);
  };

  const admit = Effect.fn('Engines.admit')(function* (slot: Slot, generation: number, settled: Deferred.Deferred<void>) {
    for (;;) {
      const waking = freed;
      if (slot.generation !== generation) return false;
      if (!busy(slot)) {
        slot.phase = { _tag: 'idle' };
        return false;
      }
      const held = [...slots.values()].filter(
        (other) => other !== slot && (other.phase._tag === 'starting' || other.phase._tag === 'running' || other.phase._tag === 'ending'),
      );
      if (held.length < budget.engines) {
        slot.phase = { _tag: 'starting', settled };
        return true;
      }
      const [idle] = held
        .filter((other) => other.phase._tag === 'running' && !busy(other))
        .sort((left, right) => lastOf(left) - lastOf(right));
      yield* idle === undefined ? Deferred.await(waking) : stop(idle, true);
    }
  });

  const feed = (phase: Running, checkout: Checkout, shifts: Stream.Stream<CheckoutShift>) =>
    Stream.runForEach(shifts, (shift) => {
      const touch = touchOf(shift);
      return touch === null ? Effect.void : checkout.touch(touch);
    }).pipe(Effect.catchTag('EngineLost', signal(phase)));

  const heads = (phase: Running, checkout: Checkout, root: string) => {
    let head: string | null | undefined;
    return Stream.runForEach(rows.headMoved(root), (moved) => {
      const before = head;
      head = moved.head;
      return before === undefined || before === moved.head ? Effect.void : checkout.touch(HEAD);
    }).pipe(Effect.catchTag('EngineLost', signal(phase)));
  };

  const bind = Effect.fnUntraced(function* (seat: Seat, phase: Running, generation: number, joined: Scope.Closeable, following: Following) {
    const checkout = yield* Scope.provide(phase.process.checkout(seat.root), joined);
    yield* feed(phase, checkout, following.shifts).pipe(Effect.forkIn(joined));
    yield* heads(phase, checkout, seat.root).pipe(Effect.forkIn(joined));
    seat.joined = { _tag: 'joined', generation, scope: joined, checkout };
  });

  const follow = (seat: Seat, into: Scope.Closeable) =>
    Scope.provide(
      Effect.acquireRelease(watch.follow(seat.rootId), (held) => Effect.sync(() => held.release())),
      into,
    );

  const open = Effect.fnUntraced(function* (slot: Slot, base: Seat, generation: number, opened: Scope.Closeable) {
    if (!allowed(base)) return yield* new EngineFailed({ detail: 'Code navigation is switched off in settings.' });
    const following = yield* follow(base, opened);
    const process = yield* Scope.provide(launcher.open({ base: base.root, memory: budget.engine, cpus: budget.cpus }), opened);
    const phase: Running = {
      _tag: 'running',
      scope: opened,
      process,
      permits: yield* Semaphore.make(budget.questions),
      lost: yield* Deferred.make<never, EngineLost>(),
      gone: yield* Deferred.make<string | null>(),
      closed: yield* Deferred.make<void>(),
      since: yield* Clock.currentTimeMillis,
      memory: null,
    };
    slot.phase = phase;
    yield* FiberSet.run(fibers, guard(slot, generation, phase));
    yield* bind(base, phase, generation, yield* Scope.fork(opened, 'sequential'), following);
    yield* spread;
  });

  const policyAt = Effect.fnUntraced(function* (rootId: RootId, preferred: number | null) {
    const place = yield* paths
      .rootAcross(rootId, preferred)
      .pipe(Effect.mapError((failure) => new EngineFailed({ detail: failure.reason })));
    if (place === null) return yield* new EngineFailed({ detail: `${rootId} belongs to no registered project` });
    const enabled = yield* settings
      .held(navigationEnabled, place.projectId)
      .pipe(Effect.mapError((failure) => new EngineFailed({ detail: failure.message })));
    return { projectId: place.projectId, enabled } satisfies Policy;
  });

  const baseOf = Effect.fnUntraced(function* (slot: Slot, seat: Seat, root: FileRoot, preferred: number) {
    const own = root.git?.gitDirectory.path;
    if (own === undefined) return seat;
    const common = basename(dirname(own)) === WORKTREES ? dirname(dirname(own)) : own;
    if (common === own || basename(common) !== '.git') return seat;
    const found = yield* roots.matching(dirname(common));
    if (found === null || found.root.git?.repositoryId !== root.git?.repositoryId || found.root.git?.gitDirectory.path !== common)
      return seat;
    const standing = slot.seats.get(found.root.rootId);
    if (standing !== undefined) return allowed(standing) ? standing : seat;
    const main = seatOf(found.root.rootId, found.root.path, yield* Clock.currentTimeMillis, yield* policyAt(found.root.rootId, preferred));
    if (!allowed(main)) return seat;
    slot.seats.set(main.rootId, main);
    return main;
  });

  const start = Effect.fn('Engines.start')(function* (slot: Slot, placed: Placed, generation: number, settled: Deferred.Deferred<void>) {
    if (!(yield* Semaphore.withPermit(gate, admit(slot, generation, settled)))) return yield* Effect.asVoid(stir);
    const opened = yield* Scope.fork(scope, 'sequential');
    const failed = Effect.fnUntraced(function* (failure: { readonly message: string }) {
      yield* Scope.close(opened, Exit.void);
      if (slot.generation !== generation) return;
      if (slot.base !== null) slot.base.joined = APART;
      if (!placed.policy.enabled()) {
        slot.phase = { _tag: 'idle' };
        yield* stir;
        return;
      }
      const now = yield* Clock.currentTimeMillis;
      slot.failures += 1;
      slot.failure = failure.message;
      slot.phase = { _tag: 'resting', detail: failure.message, until: now + rest(slot.failures) };
      yield* stir;
    });
    yield* Effect.flatMap(baseOf(slot, placed.seat, placed.root, placed.policy.projectId), (base) => {
      slot.base = base;
      return open(slot, base, generation, opened);
    }).pipe(
      Effect.catchTags({
        EngineLost: failed,
        RootMissing: failed,
        RootUnavailable: failed,
        RootInvalid: failed,
        RootConflict: failed,
        RootRefused: failed,
        EngineFailed: failed,
      }),
      Effect.onInterrupt(() => Scope.close(opened, Exit.void)),
    );
  });

  const demand = Effect.fnUntraced(function* (placed: Placed) {
    const { slot } = placed;
    const settled = yield* Deferred.make<void>();
    const now = yield* Clock.currentTimeMillis;
    const phase = slot.phase;
    const due = phase._tag === 'idle' || (phase._tag === 'resting' && now >= phase.until);
    if (!due) return;
    slot.generation += 1;
    slot.phase = { _tag: 'waiting', settled };
    slot.start = yield* FiberSet.run(
      fibers,
      detached(start(slot, placed, slot.generation, settled).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)))),
    );
  });

  const join = Effect.fn('Engines.join')(function* (seat: Seat, phase: Running, generation: number) {
    const joined = yield* Scope.fork(phase.scope, 'sequential');
    const said = (failure: { readonly message: string }) => Effect.succeed(failure.message);
    const failure = yield* Effect.flatMap(follow(seat, joined), (following) => bind(seat, phase, generation, joined, following)).pipe(
      Effect.as(null),
      Effect.catchTags({
        EngineLost: (lost) => Effect.as(signal(phase)(lost), lost.message),
        RootMissing: said,
        RootUnavailable: said,
        RootInvalid: said,
        RootConflict: said,
        RootRefused: said,
      }),
    );
    if (failure === null) return;
    yield* Scope.close(joined, Exit.void);
    seat.joined = { _tag: 'failed', generation, detail: failure };
  });

  const joinedOf = Effect.fnUntraced(function* (slot: Slot, seat: Seat, phase: Running) {
    for (;;) {
      if (slot.phase !== phase) return null;
      const joined = seat.joined;
      const current = joined._tag !== 'apart' && joined.generation === slot.generation;
      if (current && joined._tag === 'joined') return joined.checkout;
      if (current && joined._tag === 'failed') {
        seat.joined = APART;
        return joined.detail;
      }
      if (current && joined._tag === 'joining') {
        yield* Deferred.await(joined.settled);
        continue;
      }
      const settled = yield* Deferred.make<void>();
      seat.joined = { _tag: 'joining', generation: slot.generation, settled };
      yield* FiberSet.run(fibers, detached(join(seat, phase, slot.generation).pipe(Effect.ensuring(Deferred.succeed(settled, undefined)))));
    }
  });

  const place = Effect.fnUntraced(function* (root: string, preferred: number | null) {
    const match = yield* roots.matching(root);
    if (match === null) return yield* new EngineFailed({ detail: `${root} is no registered checkout` });
    const policy = yield* policyAt(match.root.rootId, preferred);
    const key = match.root.git?.repositoryId ?? match.root.rootId;
    const slot: Slot = slots.get(key) ?? {
      key,
      seats: new Map(),
      base: null,
      phase: { _tag: 'idle' },
      generation: 0,
      failures: 0,
      failure: null,
      start: null,
    };
    slots.set(key, slot);
    const standing = slot.seats.get(match.root.rootId);
    if (standing === undefined) {
      const seat = seatOf(match.root.rootId, root, yield* Clock.currentTimeMillis, policy);
      slot.seats.set(seat.rootId, seat);
      return { slot, seat, root: match.root, policy } satisfies Placed;
    }
    standing.policies.set(policy.projectId, policy);
    if (standing.root !== root) {
      standing.root = root;
      yield* Effect.forkIn(slot.base === standing ? stop(slot, false) : part(standing), scope);
    }
    return { slot, seat: standing, root: match.root, policy } satisfies Placed;
  });

  const engineOf = Effect.fnUntraced(function* (placed: Placed): Effect.fn.Return<Engine, EngineFailed | EngineDisabled, Scope.Scope> {
    const { slot, seat } = placed;
    for (;;) {
      if (!placed.policy.enabled()) return yield* new EngineDisabled({ detail: 'Code navigation is switched off in settings.' });
      yield* demand(placed);
      const phase = slot.phase;
      switch (phase._tag) {
        case 'resting': {
          const now = yield* Clock.currentTimeMillis;
          if (slot.failures >= REPEATED)
            return yield* new EngineFailed({
              detail: `it ended ${slot.failures} times in a row, last: ${phase.detail}; a question after ${new Date(phase.until).toISOString()} starts it again`,
            });
          yield* Effect.sleep(Duration.millis(Math.max(0, phase.until - now)));
          break;
        }
        case 'waiting':
        case 'starting':
          yield* Deferred.await(phase.settled);
          break;
        case 'ending':
          yield* Deferred.await(phase.closed);
          break;
        case 'running': {
          const checkout = yield* joinedOf(slot, seat, phase);
          if (typeof checkout === 'string') return yield* new EngineFailed({ detail: checkout });
          if (checkout === null) break;
          const served = yield* Effect.raceFirst(checkout.ready, Deferred.await(phase.lost)).pipe(
            Effect.catchTags({ EngineLost: () => Effect.succeed(null), CheckoutRefused: (refused) => Effect.succeed(refused) }),
          );
          if (served instanceof CheckoutRefused) {
            yield* part(seat);
            return yield* new EngineFailed({ detail: served.message });
          }
          if (served !== null)
            return {
              capability: launcher.capability,
              snapshot: served.snapshot,
              warming: served.warming,
              adapter: queued(seat, phase, served.adapter),
            };
          yield* Deferred.await(phase.closed);
          break;
        }
        case 'idle':
          break;
      }
    }
  });

  const lease = Effect.fn('Engines.lease')(function* (root: string) {
    const placed = yield* place(root, yield* QueryProject).pipe(
      Effect.mapError((failure) => (failure instanceof EngineFailed ? failure : new EngineFailed({ detail: failure.message }))),
    );
    const { seat } = placed;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        seat.leases += 1;
        seat.rested = false;
      }),
      () =>
        Effect.andThen(
          Effect.sync(() => {
            seat.leases -= 1;
          }),
          used(seat),
        ),
    );
    return yield* engineOf(placed);
  });

  const marked = (rootId: RootId, paths: readonly string[] | undefined): Effect.Effect<void> => {
    for (const slot of slots.values()) {
      const joined = slot.seats.get(rootId)?.joined;
      const phase = running(slot);
      if (joined?._tag !== 'joined' || phase === null || joined.generation !== slot.generation) continue;
      const touch: Touch = paths === undefined ? RESCAN : { _tag: 'paths', paths };
      return Effect.asVoid(joined.checkout.touch(touch).pipe(Effect.catchTag('EngineLost', signal(phase))));
    }
    return Effect.void;
  };

  const unswitch = changes.subscribe((event) =>
    event.key !== navigationEnabled.id
      ? Effect.void
      : Effect.forEach(
          [...slots.values()],
          Effect.fnUntraced(function* (slot) {
            const affected = [...slot.seats.values()]
              .flatMap((seat) => [...seat.policies.values()])
              .filter((policy) => event.projectId === null || policy.projectId === event.projectId);
            if (affected.every((policy) => policy.enabled())) return;
            if (slot.phase._tag === 'running' || slot.phase._tag === 'ending') {
              if (slot.phase._tag === 'ending') yield* Deferred.await(slot.phase.closed);
              else yield* stop(slot, false);
            } else {
              slot.generation += 1;
              if (slot.start !== null) yield* Fiber.interrupt(slot.start);
              slot.phase = { _tag: 'idle' };
              yield* stir;
            }
          }),
          { discard: true },
        ),
  );
  yield* Effect.addFinalizer(() => Effect.sync(unswitch));

  const unmark = rows.onMark(marked);
  yield* Effect.addFinalizer(() => Effect.sync(unmark));

  const measure = (phase: Running) =>
    Effect.flatMap(Effect.result(phase.process.usage), (usage) =>
      usage._tag === 'Success'
        ? Effect.sync(() => {
            phase.memory = usage.success;
          })
        : Effect.asVoid(signal(phase)(usage.failure)),
    );

  const sweep = Effect.fn('Engines.sweep')(function* () {
    const live = runningAll();
    yield* Effect.forEach(live, ({ phase }) => measure(phase), { concurrency: 'unbounded', discard: true });
    const now = yield* Clock.currentTimeMillis;
    const idle = (seat: Seat) => free(seat) && now - seat.lastUse >= Duration.toMillis(IDLE);
    const share = shareOf(budget, live.length);
    const stopping = new Set<Slot>();
    const relieved = new Set<Slot>();
    const resting: (readonly [Seat, Checkout, Running])[] = [];
    for (const { slot, phase } of live) {
      const worktrees = [...slot.seats.values()].flatMap((seat) =>
        seat !== slot.base && seat.joined._tag === 'joined' && !seat.rested && free(seat) ? [[seat, seat.joined.checkout] as const] : [],
      );
      const idled = worktrees.filter(([seat]) => idle(seat));
      for (const [seat, checkout] of idled) resting.push([seat, checkout, phase]);
      if (idled.length > 0) relieved.add(slot);
      const [oldest] = worktrees.filter(([seat]) => !idle(seat)).sort(([left], [right]) => left.lastUse - right.lastUse);
      if ((phase.memory ?? 0) <= share || relieved.has(slot) || oldest === undefined) continue;
      resting.push([...oldest, phase]);
      relieved.add(slot);
    }
    let held = live.reduce((sum, { phase }) => sum + (phase.memory ?? 0), 0);
    const spare = live
      .filter(({ slot }) => !relieved.has(slot) && !busy(slot))
      .sort((left, right) => lastOf(left.slot) - lastOf(right.slot))
      .slice(0, live.length - 1);
    for (const { slot, phase } of spare) {
      if (held <= budget.total) break;
      stopping.add(slot);
      held -= phase.memory ?? 0;
    }
    for (const [seat] of resting) seat.rested = true;
    yield* Effect.all(
      [
        ...resting.map(([, checkout, phase]) => checkout.rest.pipe(Effect.catchTag('EngineLost', signal(phase)))),
        ...[...stopping].map((slot) => stop(slot, true)),
      ],
      { concurrency: 'unbounded', discard: true },
    );
  });

  yield* drive('navigation-sweep', Effect.asVoid(detached(Effect.repeat(sweep(), Schedule.spaced(SWEEP)))));

  const phaseOf = (slot: Slot, seat: Seat, served: boolean): EnginePhase => {
    const phase = slot.phase._tag;
    if (phase !== 'running') return phase;
    if (seat.joined._tag !== 'joined') return 'idle';
    return served ? 'serving' : 'loading';
  };

  const rowOf = Effect.fnUntraced(function* (slot: Slot, seat: Seat) {
    const phase = slot.phase;
    const joined = seat.joined;
    const served = phase._tag === 'running' && joined._tag === 'joined' ? yield* Effect.scoped(joined.checkout.served) : null;
    return {
      root: seat.root,
      rootId: seat.rootId,
      engine: slot.base?.root ?? seat.root,
      base: slot.base === seat,
      phase: phaseOf(slot, seat, served !== null),
      generation: slot.generation,
      revision: served?.snapshot.revision ?? null,
      lag: served === null ? null : served.snapshot.changed.length,
      warming: served?.warming ?? false,
      memory: phase._tag === 'running' && slot.base === seat ? phase.memory : null,
      leases: seat.leases,
      questions: seat.questions,
      lastUse: new Date(seat.lastUse).toISOString(),
      failure: slot.failure,
      retryAt: phase._tag === 'resting' ? new Date(phase.until).toISOString() : null,
    } satisfies EngineRow;
  });

  const reported: EngineBudget = { ...budget, idle: `${Duration.toMinutes(IDLE)} minutes` };

  const engines = Engines.of({ lease });

  const states = EngineStates.of({
    read: Effect.fn('EngineStates.read')(function* (limit) {
      const all = [...slots.values()].flatMap((slot) => [...slot.seats.values()].map((seat) => ({ slot, seat })));
      const ordered = all.sort((left, right) => right.seat.lastUse - left.seat.lastUse).slice(0, Math.max(1, limit));
      return { budget: reported, engines: yield* Effect.forEach(ordered, ({ slot, seat }) => rowOf(slot, seat)), total: all.length };
    }),
  });

  return { engines, states };
});

export const holderLayer = Layer.effectContext(
  Effect.map(makeHolder({ machine: thisMachine() }), ({ engines, states }) =>
    Context.make(Engines, engines).pipe(Context.add(EngineStates, states)),
  ),
);
