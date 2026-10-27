import { existsSync } from 'node:fs';
import { Cause, Context, Deferred, Effect, Exit, type Fiber, FiberSet, FileSystem, type Result, type Scope, Stream } from 'effect';
import { Projects } from '../../projects/contract/service/registry.js';
import { enforcingAt } from './memory.js';
import { editChecks } from './edits.js';
import { landingSettlements } from './settlements.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { Coverage } from '../../workspace/contract/service/roots.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { AfterDelivery, EscapeNotice } from '../contract/wire/checks.js';
import {
  type EscapeTell,
  type JournalPosition,
  type JournaledLanding,
  type JournalRow,
  type LandingJournal,
  Remeasure,
} from '../contract/service/remeasure.js';
import { landingEntry } from './journal.js';
import { type Checkout, checkoutKey } from '../checkout.js';
import {
  type Aim,
  type Carried,
  chosenRules,
  fileCheck,
  remeasureRule,
  ruleSnapshot,
  startRules,
  traceEscapes,
  type Tracing,
} from './rule.js';
import { Turns } from '../workers/turns.js';
import type { Background } from '../../platform/contract/service/background.js';

export type RemeasureServices =
  | Exclude<Effect.Services<ReturnType<typeof remeasureRule>>, FileSystem.FileSystem>
  | Exclude<Effect.Services<ReturnType<typeof traceEscapes>>, FileSystem.FileSystem>
  | Effect.Services<ReturnType<typeof chosenRules>>
  | Effect.Services<ReturnType<typeof fileCheck>>;

export type RemeasureGraph = (
  projectId: number,
  root: string | null,
) => Effect.Effect<Context.Context<RemeasureServices>, { readonly message: string }, Scope.Scope>;

export const REMEASURE_DELAY_MS = 2_000;

const FAILED_RUNS_KEPT = 3;

const JOURNAL_PAGE = 64;

type Journaled = JournaledLanding & { readonly journal?: string };

type Watched = {
  readonly checkout: Checkout;
  readonly fiber: Fiber.Fiber<void>;
};

type Ask = { readonly done: Deferred.Deferred<void, GateRefusal<'inspection-failed'>>; readonly pause: number };

type Slot = {
  readonly key: string;
  readonly checkout: Checkout;
  readonly rule: string;
  hints: Carried[];
  owes: Set<string>;
  failures: number;
  waiting: boolean;
  running: boolean;
  due: boolean;
  refresh: boolean;
  pause: number;
  soonest: number;
  wake: Deferred.Deferred<void> | null;
  asked: Ask[];
  covered: Ask[];
  fiber?: Fiber.Fiber<void>;
};

type Again = (withOwes: boolean, urgent: boolean) => void;

type Traced = {
  readonly tracing: Tracing;
  readonly owes: readonly string[];
  readonly again: Again;
};

type Starting = {
  readonly done: Deferred.Deferred<void, GateRefusal<'inspection-failed'>>;
  fiber?: Fiber.Fiber<void>;
  failed: boolean;
};

export const remeasures = Effect.fn('enforcement.remeasures')(function* (options: {
  readonly graphOf: RemeasureGraph;
  readonly open: (projectId: number, root: string) => Effect.Effect<string, { readonly message: string }>;
  readonly memory: string | null;
  readonly start: Effect.Effect<void>;
  readonly forget: (projectId: number) => void;
  readonly delayMs?: number;
  readonly journal?: LandingJournal;
  readonly background: Background['Service'];
}) {
  const fork = yield* FiberSet.makeRuntime<never, void, never>();
  const files = yield* FileSystem.FileSystem;
  const checkouts = yield* CheckoutRows;
  const coverage = yield* Coverage;
  const projects = yield* Projects;
  const watched = new Map<string, Watched>();
  const starting = new Map<string, Starting>();
  const closed = new Set<string>();
  const delay = options.delayMs ?? REMEASURE_DELAY_MS;
  const enforcing = enforcingAt(options.memory);
  const slots = new Map<string, Slot>();
  const turns = new Turns(1);
  const tracings = new Turns(1);
  const settlements = landingSettlements(options.journal);
  const { acknowledge, acknowledged, park: parked, parked: parkedAll } = settlements;
  const selections = new Map<
    string,
    {
      readonly checkout: { readonly projectId: number; readonly root: string | null };
      readonly pending: { readonly aim: Aim; readonly carried: readonly Carried[]; readonly landed?: Journaled }[];
    }
  >();
  let tell: EscapeTell | null = null;

  const told = (notice: EscapeNotice): Effect.Effect<void> =>
    Effect.suspend(() =>
      tell === null
        ? Effect.logWarning('an escaped crossing has a holder, and no thread delivery stands to tell it', { thread: notice.threadId })
        : Effect.flatMap(tell(notice), (outcome) =>
            outcome._tag === 'Accepted'
              ? Effect.void
              : Effect.logInfo('an escaped crossing was not told to its holder', { thread: notice.threadId, outcome }),
          ),
    );

  const checkEdit = editChecks({ graphOf: options.graphOf, delay, fork, tell: told });

  const settled = (slot: Slot): Effect.Effect<void> =>
    Effect.suspend(() => {
      slot.running = false;
      if (slots.get(slot.key) !== slot) return Effect.void;
      if (slot.due) {
        slot.due = false;
        const pause = slot.soonest;
        slot.soonest = delay;
        wait(slot, pause);
      } else if (!slot.waiting && slot.hints.length === 0) slots.delete(slot.key);
      return Effect.void;
    });

  const taken = (slot: Slot, all: boolean): readonly Ask[] => {
    const asks = all ? [...slot.covered, ...slot.asked] : slot.covered;
    slot.covered = [];
    if (all) slot.asked = [];
    return asks;
  };

  const answered = (slot: Slot): Effect.Effect<void> =>
    Effect.suspend(() => Effect.forEach(taken(slot, false), (ask) => Deferred.succeed(ask.done, undefined), { discard: true }));

  const refused = (asks: readonly Ask[], refusal: GateRefusal<'inspection-failed'>): Effect.Effect<void> =>
    Effect.forEach(asks, (ask) => Deferred.fail(ask.done, refusal), { discard: true });

  const failedPass = (slot: Slot, cause: Cause.Cause<unknown>, owes: readonly string[], again: Again) => {
    if (Cause.hasInterruptsOnly(cause)) {
      if (slots.get(slot.key) === slot) slots.delete(slot.key);
      return parkedAll(owes, `the re-measurement of ${slot.checkout.root} was interrupted`).pipe(Effect.andThen(Effect.interrupt));
    }
    slot.failures += 1;
    const kept = slot.failures < FAILED_RUNS_KEPT;
    again(kept, false);
    slot.due ||= kept;
    if (!kept) slot.failures = 0;
    const covered = taken(slot, false);
    const reason = `the rule ${slot.rule} could not be re-measured ${FAILED_RUNS_KEPT} times in a row: ${Cause.pretty(cause)}`;
    return Effect.andThen(
      kept
        ? Effect.void
        : refused(
            covered,
            new GateRefusal('inspection-failed', reason, ['fix the reported inspection failure, then run the act again']),
          ).pipe(Effect.andThen(parkedAll(owes, reason))),
      Effect.logWarning('an enforced rule could not be re-measured', {
        rule: slot.rule,
        checkout: slot.checkout.root,
        cause: Cause.pretty(cause),
      }),
    );
  };

  const inGraph = <A, E>(slot: Slot, work: Effect.Effect<A, E, RemeasureServices | FileSystem.FileSystem>) =>
    Effect.exit(
      Effect.gen(function* () {
        const context = yield* options.graphOf(slot.checkout.projectId, slot.checkout.root);
        return yield* Effect.provide(Effect.provideService(work, FileSystem.FileSystem, files), context);
      }).pipe(Effect.scoped),
    );

  const measure = (slot: Slot): Effect.Effect<Traced | undefined> => {
    const hints = slot.hints;
    const owes = [...slot.owes];
    const refresh = slot.refresh;
    slot.refresh = false;
    slot.hints = [];
    slot.owes.clear();
    slot.covered = slot.asked;
    slot.asked = [];
    const again: Again = (withOwes, urgent) => {
      slot.hints = [...hints, ...slot.hints];
      slot.refresh ||= refresh;
      if (!withOwes) return;
      for (const key of owes) slot.owes.add(key);
      const back = taken(slot, false);
      slot.asked = [...back, ...slot.asked];
      if (urgent) for (const ask of back) slot.soonest = Math.min(slot.soonest, ask.pause);
    };
    return inGraph(slot, remeasureRule(slot.checkout.projectId, slot.rule, hints, refresh)).pipe(
      Effect.flatMap((exit) => {
        if (Exit.isFailure(exit)) return Effect.as(failedPass(slot, exit.cause, owes, again), undefined);
        slot.failures = 0;
        const measured = exit.value;
        if (measured._tag === 'Stale') {
          again(true, true);
          slot.due = true;
          return Effect.succeed(undefined);
        }
        if (measured._tag !== 'Measured') return Effect.as(Effect.andThen(answered(slot), acknowledged(owes)), undefined);
        return Effect.forEach(
          measured.notices,
          (notice) =>
            Effect.exit(told(notice)).pipe(
              Effect.flatMap((delivered) =>
                Exit.isFailure(delivered)
                  ? Effect.logWarning('a re-measured crossing could not be told to its holder', {
                      rule: slot.rule,
                      cause: Cause.pretty(delivered.cause),
                    })
                  : Effect.void,
              ),
            ),
          { discard: true },
        ).pipe(
          Effect.andThen(answered(slot)),
          Effect.andThen(
            Effect.suspend(() => {
              const { tracing } = measured;
              if (tracing === undefined) return Effect.as(acknowledged(owes), undefined);
              return Effect.succeed<Traced>({ tracing, owes, again });
            }),
          ),
        );
      }),
    );
  };

  const trace = (slot: Slot, { tracing, owes, again }: Traced): Effect.Effect<void> =>
    inGraph(slot, traceEscapes(slot.checkout.projectId, tracing)).pipe(
      Effect.flatMap((exit) => {
        if (Exit.isFailure(exit)) return failedPass(slot, exit.cause, owes, again);
        slot.failures = 0;
        if (exit.value._tag !== 'Stale') return acknowledged(owes);
        again(true, true);
        slot.due = true;
        return Effect.void;
      }),
    );

  const wait = (slot: Slot, pause = delay) => {
    slot.waiting = true;
    slot.pause = pause;
    const wake = Deferred.makeUnsafe<void>();
    slot.wake = wake;
    slot.fiber = fork(
      Effect.raceFirst(Effect.sleep(pause), Deferred.await(wake)).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            turns.within({}, () =>
              Effect.suspend(() => {
                slot.waiting = false;
                slot.running = true;
                return options.background.run(
                  { title: 'Re-measuring an enforced rule', reason: `Rule ${slot.rule} is measured again after a change.`, total: null },
                  () => measure(slot),
                );
              }),
            ),
          ),
        ),
        Effect.flatMap((rest) =>
          rest === undefined
            ? Effect.void
            : tracings.within({}, () =>
                options.background.run(
                  {
                    title: 'Tracing where escaped crossings came from',
                    reason: `New crossings of rule ${slot.rule} are traced to the version that let them in.`,
                    total: null,
                  },
                  () => trace(slot, rest),
                ),
              ),
        ),
        Effect.ensuring(Effect.suspend(() => (slot.running ? settled(slot) : Effect.void))),
        Effect.onExit((exit) => {
          if (Exit.isSuccess(exit)) return Effect.void;
          if (!Cause.hasInterruptsOnly(exit.cause))
            return refused(
              taken(slot, false),
              new GateRefusal('inspection-failed', `the re-measurement of ${slot.checkout.root} failed: ${Cause.pretty(exit.cause)}`, [
                'fix the reported failure, then run the act again',
              ]),
            );
          if (slots.get(slot.key) === slot) slots.delete(slot.key);
          const owes = [...slot.owes];
          slot.owes.clear();
          const reason = `the re-measurement of ${slot.checkout.root} was interrupted`;
          return refused(taken(slot, true), new GateRefusal('inspection-failed', reason, ['open the graph copy to re-measure it'])).pipe(
            Effect.andThen(parkedAll(owes, reason)),
          );
        }),
      ),
    );
  };

  const schedule = (checkout: Checkout, rule: string, hints: readonly Carried[], pause = delay, journal?: string, refresh = true) => {
    const key = `${checkoutKey(checkout)}\0${rule}`;
    const slot = slots.get(key) ?? {
      key,
      checkout,
      rule,
      hints: [],
      owes: new Set<string>(),
      failures: 0,
      waiting: false,
      running: false,
      due: false,
      refresh: false,
      pause: delay,
      soonest: delay,
      wake: null,
      asked: [],
      covered: [],
    };
    slots.set(key, slot);
    slot.refresh ||= refresh;
    slot.hints.push(...hints);
    if (journal !== undefined && !slot.owes.has(journal)) {
      slot.owes.add(journal);
      settlements.owe(journal);
    }
    const ask: Ask = { done: Deferred.makeUnsafe(), pause };
    slot.asked.push(ask);
    if (slot.running) {
      slot.due = true;
      slot.soonest = Math.min(slot.soonest, pause);
    } else if (!slot.waiting) wait(slot, pause);
    else if (pause < slot.pause && slot.wake !== null) Deferred.doneUnsafe(slot.wake, Exit.void);
    return ask.done;
  };

  const place = (
    checkout: Checkout,
    chosen: { readonly rules: readonly string[] },
    carried: readonly Carried[],
    landed?: Journaled,
    pause = delay,
    refresh = true,
  ) => {
    if (closed.has(checkoutKey(checkout))) {
      if (landed?.journal !== undefined) fork(parked(landed.journal, `the graph copy of ${checkout.root} closed before re-measurement`));
      return [];
    }
    const completions = chosen.rules.map((rule) =>
      schedule(
        checkout,
        rule,
        carried.filter((one) => one.rule === rule),
        pause,
        landed?.journal,
        refresh,
      ),
    );
    if (landed?.journal !== undefined && !settlements.owes(landed.journal)) fork(acknowledge(landed.journal));
    return completions;
  };

  const observe = (checkout: Checkout, enforcing: boolean): void => {
    const key = checkoutKey(checkout);
    if (!enforcing || closed.has(key)) {
      watched.get(key)?.fiber.interruptUnsafe();
      watched.delete(key);
    } else if (!watched.has(key)) {
      watched.set(key, {
        checkout,
        fiber: fork(
          Stream.runForEach(checkouts.headMoved(checkout.root), ({ head }) =>
            Effect.sync(() => {
              if (head === null) return;
              for (const slot of slots.values()) {
                if (slot.running && checkoutKey(slot.checkout) === key) slot.due = true;
              }
              enqueue(checkout, { _tag: 'Moved' }, []);
            }),
          ),
        ),
      });
    }
  };

  const finishStart = (started: Starting, root: string | null, outcome: Exit.Exit<unknown, unknown>): Effect.Effect<void> => {
    if (Exit.isSuccess(outcome)) return Effect.asVoid(Deferred.succeed(started.done, undefined));
    started.failed = true;
    return Effect.asVoid(
      Deferred.fail(
        started.done,
        new GateRefusal('inspection-failed', `the opening re-measurement of ${root} failed: ${Cause.pretty(outcome.cause)}`, [
          'fix the reported inspection failure, then run the act again',
        ]),
      ),
    );
  };

  const select = Effect.fnUntraced(
    function* (
      checkout: { readonly projectId: number; readonly root: string | null },
      aim: Aim,
      carried: readonly Carried[],
      landed?: Journaled,
      attempts = 0,
      started?: Starting,
    ) {
      if (aim._tag === 'Start' && checkout.root !== null && !existsSync(checkout.root)) {
        const missing = { projectId: checkout.projectId, root: checkout.root };
        observe(missing, false);
        return yield* enforcing.keep(missing, false);
      }
      const context = yield* options.graphOf(checkout.projectId, checkout.root);
      const snapshot = aim._tag === 'Start' ? yield* Effect.provide(ruleSnapshot(checkout.projectId), context) : undefined;
      const chosen = yield* Effect.provide(chosenRules(checkout.projectId, aim, snapshot), context);
      if (chosen === null) return;
      const measured = { projectId: checkout.projectId, root: chosen.root };
      if (aim._tag === 'Start' && checkout.root !== null && chosen.root !== checkout.root) {
        const missing = { projectId: checkout.projectId, root: checkout.root };
        observe(missing, false);
        return yield* enforcing.keep(missing, false);
      }
      yield* enforcing.keep(measured, chosen.enforcing);
      observe(measured, chosen.enforcing);
      const rules =
        snapshot === undefined
          ? chosen.rules
          : yield* Effect.provide(Effect.provideService(startRules(snapshot, chosen.rules), FileSystem.FileSystem, files), context);
      return place(measured, { rules }, carried, landed, aim._tag === 'Start' ? 0 : delay, aim._tag !== 'Start');
    },
    (effect, checkout, aim, carried, landed: Journaled | undefined = undefined, attempts = 0, started: Starting | undefined = undefined) =>
      effect.pipe(
        Effect.scoped,
        Effect.exit,
        Effect.flatMap((outcome) => {
          if (Exit.isSuccess(outcome))
            return started === undefined
              ? Effect.void
              : Effect.exit(Effect.forEach(outcome.value ?? [], Deferred.await, { discard: true })).pipe(
                  Effect.flatMap((measured) => finishStart(started, checkout.root, measured)),
                );
          if (Cause.hasInterruptsOnly(outcome.cause))
            return started === undefined ? Effect.interrupt : finishStart(started, checkout.root, outcome);
          if (closed.has(checkoutKey(checkout)))
            return landed?.journal === undefined
              ? Effect.void
              : parked(landed.journal, `the graph copy of ${checkout.root} closed before re-measurement`);
          if (attempts < 2) {
            const retried = fork(Effect.sleep(delay).pipe(Effect.andThen(select(checkout, aim, carried, landed, attempts + 1, started))));
            if (started !== undefined) started.fiber = retried;
          } else {
            if (landed?.journal !== undefined)
              fork(parked(landed.journal, `the enforced rules could not be read after three attempts: ${Cause.pretty(outcome.cause)}`));
            if (started !== undefined) fork(finishStart(started, checkout.root, outcome));
          }
          return Effect.logWarning(
            attempts < 2
              ? 'the enforced rules to re-measure could not be read; another reading is scheduled'
              : 'the enforced rules could not be read after three attempts; this change was not re-measured',
            {
              checkout: checkout.root ?? `project ${checkout.projectId}`,
              cause: Cause.pretty(outcome.cause),
            },
          );
        }),
      ),
  );

  const opened = (projectId: number, root: string): Starting => {
    const checkout = { projectId, root };
    const key = checkoutKey(checkout);
    closed.delete(key);
    const current = starting.get(key);
    if (current !== undefined) return current;
    const started: Starting = { done: Deferred.makeUnsafe(), failed: false };
    starting.set(key, started);
    started.fiber = fork(select(checkout, { _tag: 'Start' }, [], undefined, 0, started));
    return started;
  };

  const close = (projectId: number, root: string): void => {
    const key = checkoutKey({ projectId, root });
    closed.add(key);
    observe({ projectId, root }, false);
    selections.delete(key);
    for (const slot of slots.values()) {
      if (checkoutKey(slot.checkout) !== key) continue;
      slots.delete(slot.key);
      slot.fiber?.interruptUnsafe();
    }
    const started = starting.get(key);
    started?.fiber?.interruptUnsafe();
    if (started !== undefined)
      fork(
        Effect.asVoid(
          Deferred.fail(
            started.done,
            new GateRefusal('inspection-failed', `the graph copy of ${root} closed before its opening re-measurement completed`, [
              'open the graph copy and run the act again',
            ]),
          ),
        ),
      );
    starting.delete(key);
  };

  const open = Effect.fnUntraced(function* (projectId: number, root: string) {
    const openedCopy = yield* Effect.result(options.open(projectId, root));
    if (openedCopy._tag === 'Success') {
      opened(projectId, openedCopy.success);
      return true;
    }
    yield* Effect.logWarning('a checkout owed to re-measurement could not be opened', {
      projectId,
      root,
      reason: openedCopy.failure.message,
    });
    return false;
  });

  const flush = Effect.fnUntraced(function* (key: string): Effect.fn.Return<void> {
    const slot = selections.get(key);
    if (slot === undefined) return;
    const pending = slot.pending.splice(0);
    const planned = yield* Effect.exit(
      Effect.gen(function* () {
        const context = yield* options.graphOf(slot.checkout.projectId, slot.checkout.root);
        const snapshot = yield* Effect.provide(ruleSnapshot(slot.checkout.projectId), context);
        const chosen = yield* Effect.forEach(pending, (item) =>
          Effect.provide(chosenRules(slot.checkout.projectId, item.aim, snapshot), context),
        );
        const measured = { projectId: slot.checkout.projectId, root: snapshot.root };
        const active = chosen.find((one) => one !== null);
        if (active !== undefined && active !== null) {
          yield* enforcing.keep(measured, active.enforcing);
          observe(measured, active.enforcing);
        }
        return { chosen, measured };
      }).pipe(Effect.scoped),
    );
    if (Exit.isSuccess(planned)) {
      pending.forEach((item, at) => {
        const chosen = planned.value.chosen[at];
        if (chosen !== null && chosen !== undefined) place(planned.value.measured, chosen, item.carried, item.landed, 0);
        else if (item.landed?.journal !== undefined) fork(acknowledge(item.landed.journal));
      });
    } else {
      for (const item of pending) yield* select(slot.checkout, item.aim, item.carried, item.landed);
    }
    if (selections.get(key) !== slot) return;
    if (slot.pending.length > 0) fork(flush(key));
    else selections.delete(key);
  });

  const enqueue = (
    checkout: { readonly projectId: number; readonly root: string | null },
    aim: Aim,
    carried: readonly Carried[],
    landed?: Journaled,
  ): void => {
    const key = checkoutKey(checkout);
    const held = selections.get(key);
    if (held !== undefined) {
      if (aim._tag === 'Checked' && held.pending.some((item) => item.aim._tag === 'Checked' && item.aim.op === aim.op)) return;
      if (aim._tag === 'Moved' && held.pending.some((item) => item.aim._tag === 'Moved')) return;
      held.pending.push({ aim, carried, landed });
      return;
    }
    selections.set(key, { checkout, pending: [{ aim, carried, landed }] });
    fork(Effect.sleep(delay).pipe(Effect.andThen(flush(key))));
  };

  const covered = Effect.fn('enforcement.remeasureCheckouts')(function* (projectId: number) {
    const reading = yield* Effect.result(coverage.covered(projectId));
    if (reading._tag === 'Failure') {
      yield* Effect.logWarning('enforcement keeps its HEAD observations: checkout coverage could not be read', {
        projectId,
        reason: reading.failure.message,
      });
      return null;
    }
    return reading.success.roots.map(({ path }): Checkout => ({ projectId, root: path }));
  });

  const reconcile = Effect.fnUntraced(function* (projectId: number) {
    const roots = yield* covered(projectId);
    const standing = roots === null ? null : new Set(roots.map(checkoutKey));
    const known = new Map(enforcing.all().map((checkout) => [checkoutKey(checkout), checkout]));
    for (const [key, { checkout }] of watched) known.set(key, checkout);
    const departed = [...known].flatMap(([key, checkout]) =>
      checkout.projectId === projectId && ((standing !== null && !standing.has(key)) || !existsSync(checkout.root)) ? [checkout] : [],
    );
    for (const checkout of departed) close(checkout.projectId, checkout.root);
    yield* enforcing.forget(departed).pipe(
      Effect.catchTag('GateRefusal', (failure) =>
        Effect.logWarning('departed checkouts stopped being observed but could not be removed from remeasurement memory', {
          projectId,
          reason: failure.reason,
        }),
      ),
    );
  });

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      coverage.onCovered((projectId) => {
        fork(reconcile(projectId));
      }),
    ),
    (release) => Effect.sync(release),
  );

  const drive = Effect.sync(() => {
    fork(enforcingOpened);
    fork(options.start.pipe(Effect.andThen(options.journal === undefined ? Effect.void : replay(options.journal))));
  });

  const enforcingOpened = options.start.pipe(
    Effect.andThen(
      Effect.gen(function* () {
        for (const projectId of new Set(enforcing.all().map((checkout) => checkout.projectId))) {
          yield* reconcile(projectId);
          const row = yield* Effect.result(projects.byId(projectId));
          if (row._tag === 'Success') yield* open(projectId, row.success.rootPath);
          else
            yield* Effect.logWarning('an enforcing project could not be opened for its initial re-measurement', {
              projectId,
              reason: row.failure.message,
            });
        }
      }),
    ),
  );

  const placeLanding = (landed: Journaled): void => {
    enqueue(
      { projectId: landed.projectId, root: landed.root },
      { _tag: 'Landed', op: landed.op, commit: landed.commit, paths: landed.paths },
      (landed.carried ?? []).map((one) => ({ ...one, commit: landed.commit, told: landed.told === true ? (true as const) : undefined })),
      landed,
    );
  };

  const replay = Effect.fnUntraced(function* (journal: LandingJournal) {
    let after: JournalPosition | null = null;
    for (;;) {
      const rows: Result.Result<readonly JournalRow[], StoreFailure> = yield* Effect.result(journal.page(after, JOURNAL_PAGE));
      if (rows._tag === 'Failure')
        return yield* Effect.logWarning('the landings still owed to re-measurement could not be read, so they wait for the next start', {
          reason: rows.failure.message,
        });
      for (const { key, landing } of rows.success) {
        if (settlements.has(key)) continue;
        settlements.remember(key);
        if (landing === null) {
          yield* parked(key, 'its journaled payload no longer decodes');
          continue;
        }
        if (yield* open(landing.projectId, landing.root)) placeLanding({ ...landing, journal: key });
      }
      const last = rows.success.at(-1);
      if (last === undefined || rows.success.length < JOURNAL_PAGE) return;
      after = { at: last.at, key: last.key };
    }
  });

  const remeasure = Remeasure.of({
    opened,
    closed: close,
    ready: Effect.fn('Remeasure.ready')(function* (projectId, root) {
      const asked =
        root ??
        (yield* projects.byId(projectId).pipe(
          Effect.map((row) => row.rootPath),
          Effect.mapError(
            (failure) => new GateRefusal('inspection-failed', failure.message, ['restore the registered project, then run the act again']),
          ),
        ));
      const checkout = yield* options
        .open(projectId, asked)
        .pipe(
          Effect.mapError(
            (failure) => new GateRefusal('inspection-failed', failure.message, ['restore the graph copy, then run the act again']),
          ),
        );
      const key = checkoutKey({ projectId, root: checkout });
      if (starting.get(key)?.failed === true) starting.delete(key);
      yield* Deferred.await(opened(projectId, checkout).done);
    }),
    landed: Effect.fnUntraced(function* (op, landed) {
      const journal = options.journal;
      if (journal === undefined) {
        placeLanding({ ...landed, op });
        return;
      }
      const entry = yield* landingEntry({ ...landed, op });
      const { key } = entry;
      if (settlements.has(key)) return;
      const kept = yield* Effect.result(journal.put(entry));
      if (kept._tag === 'Failure') {
        placeLanding({ ...landed, op });
        return {
          delivered: false,
          reason: `the landing of ${landed.commit} could not be kept for re-measurement: ${kept.failure.message}`,
        } satisfies AfterDelivery;
      }
      settlements.remember(key);
      placeLanding({ ...landed, op, journal: key });
    }),
    checked: (op, subject) =>
      subject.kind === 'head'
        ? Effect.sync(() => enqueue({ projectId: subject.projectId, root: subject.root ?? null }, { _tag: 'Checked', op }, []))
        : checkEdit(op, subject),
    enforced: (at) =>
      Effect.sync(() => {
        options.forget(at.projectId);
        fork(
          Effect.gen(function* () {
            if (at.root !== null && (yield* open(at.projectId, at.root)))
              yield* select({ projectId: at.projectId, root: at.root }, { _tag: 'Enforced', rule: at.rule }, []);
            const row = yield* Effect.result(projects.byId(at.projectId));
            if (row._tag === 'Success' && row.success.rootPath !== at.root && (yield* open(at.projectId, row.success.rootPath)))
              yield* select({ projectId: at.projectId, root: row.success.rootPath }, { _tag: 'Enforced', rule: at.rule }, []);
            else if (row._tag === 'Failure')
              yield* Effect.logWarning('an enforced rule could not be re-measured in its main checkout', {
                projectId: at.projectId,
                reason: row.failure.message,
              });
            yield* reconcile(at.projectId);
          }),
        );
      }),
    tell: told,
    telling: (next) => {
      tell = next;
      return () => {
        if (tell === next) tell = null;
      };
    },
  });
  return { remeasure, drive };
});
