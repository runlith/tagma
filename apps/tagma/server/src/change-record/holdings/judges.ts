import { totalmem } from 'node:os';
import { Deferred, Effect, FileSystem, Queue, Scope, Stream } from 'effect';
import { and, inArray } from 'drizzle-orm';
import { Git } from '@runlith/git/Git';
import { chunk, unique } from '@runlith/utils/collection';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { CheckoutRows, GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { Holding, HoldingsFrame, HoldingsView, ThreadHeld, ThreadTotals } from '../contract/wire/holdings.js';
import type { CheckoutHolder } from '../../workspace/contract/wire/checkout.js';
import { Holdings, type HoldingsChange, type HoldingsFailure, type Judged } from '../contract/service/holdings.js';
import type { HeldChange } from '../contract/service/held.js';
import { standing, workspaceChange } from '../store/tables.js';
import type { FoldMemory } from '../lines/memory.js';
import type { FoldRecall } from '../lines/residence.js';
import type { Walks } from '../lines/walks.js';
import type { GitMetadata } from '../record/metadata.js';
import { introduced } from './introduced.js';
import { type Folder, type Judge, type JudgeParts, makeJudge } from './judge.js';
import { holdersOf, Totals } from './totals.js';
import { annotationsAt } from './annotation.js';
import { Details } from './details.js';

const THREADS_PER_STATEMENT = rowsPerStatement(1);

export const judgedChange = (judges: Judges, change: HeldChange): Effect.Effect<void> => {
  const byCheckout = new Map<string, string[]>();
  for (const place of change.moved.places) {
    const paths = byCheckout.get(place.checkout);
    if (paths === undefined) byCheckout.set(place.checkout, [place.path]);
    else paths.push(place.path);
  }
  return Effect.forEach(byCheckout, ([checkout, paths]) => judges.moved(RootId.make(checkout), paths), { discard: true });
};

export type Judges = Effect.Success<ReturnType<typeof makeJudges>>;

export const makeJudges = Effect.fnUntraced(function* ({
  folder,
  walks,
  memory,
  metadata,
}: {
  readonly folder: Folder;
  readonly walks: Walks;
  readonly memory: FoldMemory<FoldRecall>;
  readonly metadata: GitMetadata;
}) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const roots = yield* FileRoots;
  const checkouts = yield* CheckoutRows;
  const scope = yield* Effect.scope;
  const readers = { store, units, git: yield* Git, files: yield* FileSystem.FileSystem, walks };
  const totals = new Totals();
  const judges = new Map<string, Judge>();
  const opening = new Map<string, { readonly owed: Deferred.Deferred<Judge, HoldingsFailure>; waiters: number }>();
  const users = new Map<Judge, number>();
  const listeners = new Set<(change: HoldingsChange) => Effect.Effect<void>>();
  const statings = new Set<(checkout: RootId) => Effect.Effect<void>>();

  const parts: JudgeParts = {
    readers,
    folder,
    memory,
    details: new Details(Math.min(32 * 1024 * 1024, Math.floor(totalmem() / 256))),
    totals,
    metadata,
    graphDirectory: yield* GraphDirectory,
    publish: (change) => Effect.forEach([...listeners], (listener) => listener(change), { discard: true }),
    stated: (checkout) => Effect.forEach([...statings], (listener) => listener(checkout), { discard: true }),
  };

  const idle = (judge: Judge): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (judges.get(judge.checkout.rootId) !== judge || !judge.empty() || users.has(judge)) return Effect.void;
      judges.delete(judge.checkout.rootId);
      return judge.close;
    });

  const taken = (judge: Judge, count: number): void => {
    users.set(judge, (users.get(judge) ?? 0) + count);
  };

  const returned = (judge: Judge): Effect.Effect<void> =>
    Effect.suspend(() => {
      const left = (users.get(judge) ?? 1) - 1;
      if (left === 0) users.delete(judge);
      else users.set(judge, left);
      return idle(judge);
    });

  const judgeOf = (checkout: RootId): Effect.Effect<Judge, HoldingsFailure> =>
    Effect.suspend(() => {
      const known = judges.get(checkout);
      if (known !== undefined) {
        taken(known, 1);
        return Effect.succeed(known);
      }
      const standing = opening.get(checkout);
      if (standing !== undefined) {
        standing.waiters += 1;
        return Deferred.await(standing.owed);
      }
      const owed = Deferred.makeUnsafe<Judge, HoldingsFailure>();
      const started = { owed, waiters: 1 };
      opening.set(checkout, started);
      return Effect.gen(function* () {
        const root = yield* roots.read(checkout);
        const own = yield* Scope.fork(scope);
        const judge: Judge = makeJudge({ checkout: { rootId: checkout, dir: root.path }, parts, scope: own, idle: () => idle(judge) });
        judges.set(checkout, judge);
        taken(judge, started.waiters);
        yield* Effect.forkIn(
          Stream.runForEach(checkouts.headMoved(root.path), (moved) => judge.headMoved(moved.head)),
          own,
        );
        yield* judge.shift('all');
        return judge;
      }).pipe(
        Effect.onExit((exit) =>
          Effect.andThen(
            Effect.sync(() => opening.delete(checkout)),
            Deferred.done(owed, exit),
          ),
        ),
      );
    });

  const using = <A, E, R>(checkout: RootId, use: (judge: Judge) => Effect.Effect<A, E, R>): Effect.Effect<A, E | HoldingsFailure, R> =>
    Effect.acquireUseRelease(judgeOf(checkout), use, returned);

  const checkoutsOf = (holders: readonly string[]): Effect.Effect<readonly string[], StoreFailure> =>
    Effect.map(
      Effect.forEach(chunk(unique(holders), THREADS_PER_STATEMENT), (ids) =>
        units.read((unit) =>
          unit.run(
            store.db
              .selectDistinct({ checkout: workspaceChange.checkout })
              .from(workspaceChange)
              .where(and(inArray(workspaceChange.holder, ids), standing)),
          ),
        ),
      ),
      (groups) => unique(groups.flat().map((row) => row.checkout)),
    );

  const touched = (checkout: RootId): Effect.Effect<void> => {
    const known = judges.get(checkout);
    if (known !== undefined) return known.shift('all');
    return Effect.flatMap(Effect.result(using(checkout, () => Effect.void)), (opened) =>
      opened._tag === 'Success'
        ? Effect.void
        : Effect.logWarning('holdings could not open a checkout', { checkout, reason: opened.failure.message }),
    );
  };

  const changed = (listener: (change: HoldingsChange) => Effect.Effect<void>): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const stated = (listener: (checkout: RootId) => Effect.Effect<void>): (() => void) => {
    statings.add(listener);
    return () => {
      statings.delete(listener);
    };
  };

  const read = (checkout: RootId, wait?: 'settled'): Effect.Effect<HoldingsView, HoldingsFailure> =>
    using(checkout, (judge) =>
      Effect.map(wait === 'settled' ? judge.settledView : Effect.sync(judge.view), (view) => ({
        ...view,
        paths: view.paths.map((entry) => entry.holding),
      })),
    );

  const meta = (checkout: RootId): Effect.Effect<Omit<HoldingsView, 'paths'>, HoldingsFailure> =>
    using(checkout, (judge) => Effect.sync(() => judge.meta()));

  const follow = Effect.fnUntraced(function* (checkout: RootId) {
    const judge = yield* Effect.acquireRelease(judgeOf(checkout), returned);
    yield* Effect.acquireRelease(
      Effect.sync(() => judge.joined()),
      () => judge.left(),
    );
    const rows = yield* checkouts.follow(checkout);
    yield* Effect.forkScoped(
      Stream.runForEach(rows, (row) => {
        const areas = [row.entries.staged, row.entries.unstaged, row.entries.untracked, row.entries.unmerged];
        return judge.follow(unique(areas.flatMap((area) => area.entries.map((entry) => entry.path))), row.revision);
      }),
    );
  });

  const frames = (checkout: RootId): Stream.Stream<HoldingsFrame, HoldingsFailure> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const pending = new Map<string, Holding | null>();
        const wake = yield* Queue.sliding<void>(1);
        const stopChanges = changed((change) => {
          if (change.checkout !== checkout) return Effect.void;
          for (const holding of change.changed) pending.set(holding.path, holding);
          for (const path of change.gone) pending.set(path, null);
          return Effect.asVoid(Queue.offer(wake, undefined));
        });
        const stopStates = stated((moved) => (moved === checkout ? Effect.asVoid(Queue.offer(wake, undefined)) : Effect.void));
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stopChanges();
            stopStates();
          }),
        );
        yield* follow(checkout);
        const first = yield* read(checkout);
        pending.clear();
        const whole: HoldingsFrame = { kind: 'whole', ...first, checkout };
        const next = Effect.gen(function* () {
          yield* Queue.take(wake);
          const view = yield* meta(checkout);
          const moved: Holding[] = [];
          const gone: string[] = [];
          for (const [path, holding] of pending) {
            if (holding === null) gone.push(path);
            else moved.push(holding);
          }
          pending.clear();
          return { kind: 'change', ...view, checkout, changed: moved, gone } satisfies HoldingsFrame;
        });
        return Stream.concat(Stream.make(whole), Stream.fromEffectRepeat(next));
      }),
    );

  return {
    ...Holdings.of({
      read,
      changed,
      follow,
      subscribe: frames,
      judged: (checkout, paths, scope) =>
        paths.length === 0 ? Effect.succeed(new Map<string, Judged>()) : using(checkout, (judge) => judge.judged(unique(paths), scope)),
      settled: (checkout) => using(checkout, (judge) => judge.quiet),
      introduced: (checkout, steps, decide) =>
        Effect.flatMap(roots.read(checkout), (root) => introduced(readers, folder, { rootId: checkout, dir: root.path }, steps, decide)),
      lease: (checkout, paths, work) => using(checkout, (judge) => judge.lease(paths, work)),
      moved: (checkout, paths) => {
        const known = judges.get(checkout);
        if (known !== undefined) return known.shift(paths);
        if (paths === 'all' || paths.length === 0) return Effect.void;
        return touched(checkout);
      },
      threads: Effect.fnUntraced(function* (threadIds) {
        if (threadIds.length === 0) return new Map<string, ThreadTotals>();
        const held = yield* checkoutsOf(threadIds);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const opened = yield* Effect.forEach(
              held,
              (checkout) => Effect.result(Effect.acquireRelease(judgeOf(RootId.make(checkout)), returned)),
              { concurrency: 4 },
            );
            for (const judge of opened) {
              if (judge._tag === 'Success') yield* judge.success.settledOnce;
              else yield* Effect.logWarning('a thread total leaves out a checkout that could not open', { reason: judge.failure.message });
            }
          }),
        );
        return new Map(threadIds.map((thread) => [thread, totals.holder(thread)] as const));
      }),
      heldCheckouts: Effect.fnUntraced(function* (holders) {
        for (const checkout of yield* checkoutsOf(holders)) yield* using(RootId.make(checkout), (judge) => judge.quiet);
        return totals.checkoutsOf(holders);
      }),
    }),
    stated,
    meta,
    touched,
    checkoutsOf,
    hold: (checkout: RootId): Effect.Effect<void, HoldingsFailure, Scope.Scope> =>
      Effect.asVoid(Effect.acquireRelease(judgeOf(checkout), returned)),
    holdersOf: (
      checkout: RootId,
      paths: readonly string[],
    ): Effect.Effect<ReadonlyMap<string, readonly CheckoutHolder[]>, HoldingsFailure> =>
      paths.length === 0
        ? Effect.succeed(new Map<string, readonly CheckoutHolder[]>())
        : using(checkout, (judge) =>
            Effect.gen(function* () {
              const entries = yield* judge.judged(unique(paths));
              const threads = yield* annotationsAt(
                readers,
                [...entries.values()].flatMap((entry) => holdersOf(entry.holding)),
              );
              const holders = new Map<string, readonly CheckoutHolder[]>();
              for (const [path, entry] of entries) {
                const holding = entry.holding;
                if (holding.verdict.verdict !== 'proven' || holding.verdict.hands.length === 0) continue;
                holders.set(
                  path,
                  holding.verdict.hands.map((hand) => ({
                    holder: hand.holder,
                    agentName: hand.holder.kind === 'thread' ? (threads.get(hand.holder.thread)?.name ?? null) : null,
                    retired: hand.retired,
                    writing: hand.writing,
                    tasks: [],
                  })),
                );
              }
              return holders;
            }),
          ),
    marked: (checkout: RootId, paths: readonly string[] | undefined): Effect.Effect<void> =>
      judges.get(checkout)?.marked(paths) ?? Effect.void,
    annotate: (thread: string): Effect.Effect<void, StoreFailure> =>
      Effect.forEach([...judges.values()], (judge) => judge.annotate(thread), { discard: true }),
    held: (thread: string): ThreadHeld => {
      const total = totals.holder(thread);
      return { paths: total.paths, unproven: total.unproven };
    },
    warm: Effect.flatMap(
      units.read((unit) => unit.run(store.db.selectDistinct({ checkout: workspaceChange.checkout }).from(workspaceChange).where(standing))),
      (rows) => Effect.forEach(rows, (row) => touched(RootId.make(row.checkout)), { discard: true }),
    ),
  };
});
