import { Deferred, Effect, Exit, type Fiber, FiberSet, FileSystem, Scope, Semaphore, Stream, SubscriptionRef } from 'effect';
import * as Schema from 'effect/Schema';
import type { IdentityWitness } from '@runlith/files/namespace';
import { permits } from '@runlith/held/Permits';
import { Git } from '@runlith/git/Git';
import { CheckoutState, type CheckoutArea } from '../contract/wire/checkout.js';
import type { RootId } from '../contract/wire/ids.js';
import type { RootResolutionFailure } from '../contract/wire/roots.js';
import { FileRoots } from '../contract/service/roots.js';
import { CheckoutRows } from '../contract/service/checkouts.js';
import { CheckoutWatch, type CheckoutShift, type Following } from '../contract/service/watch.js';
import { openRereading, type Rereading, rereading, wake } from '../../platform/rereading.js';
import { outsideRepository } from '../repositories/discovery.js';
import { makeHeadWatches } from '../watch/heads.js';
import { makeTopologyWatches } from '../watch/topology.js';
import { readRow, sharedTreeCell, type Compared, type GitFailure, type SharedReading, type SharedTree } from './comparison.js';

const LINGER = '30 seconds';

const READINGS = 3;

const WIDENING = /(?:^|\/)\.git(?:ignore|attributes|modules)?(?:\/|$)/;

const sameState = Schema.toEquivalence(CheckoutState);

const EMPTY_AREA: CheckoutArea = { entries: [], added: 0, removed: 0 };

const unread = (rootId: RootId, path: string): CheckoutState => ({
  rootId,
  path,
  revision: 0,
  head: null,
  ref: null,
  upstream: null,
  publishTo: null,
  ahead: null,
  behind: null,
  operation: 'none',
  entries: { staged: EMPTY_AREA, unstaged: EMPTY_AREA, untracked: EMPTY_AREA, unmerged: EMPTY_AREA },
  compare: null,
  unresolvedBase: null,
  coverage: { untracked: 'all', paths: null },
  repository: true,
  incomplete: false,
  stale: true,
  unwatched: true,
  slowStatus: false,
});

const unversioned = (standing: CheckoutState, unwatched: boolean): CheckoutState => ({
  ...unread(standing.rootId, standing.path),
  revision: standing.revision,
  repository: false,
  stale: false,
  unwatched,
});

export type CheckoutRowKey = { readonly rootId: RootId; readonly base: string | null };

const keyOf = (asked: CheckoutRowKey): string => (asked.base === null ? asked.rootId : `${asked.rootId}\u0000${asked.base}`);

type RootState = Rereading & {
  readonly rootId: RootId;
  readonly base: string | null;
  readonly key: string;
  readonly dir: string;
  readonly witness: IdentityWitness;
  readonly rows: SubscriptionRef.SubscriptionRef<CheckoutState>;
  readonly finished: SubscriptionRef.SubscriptionRef<number>;
  result: Exit.Exit<CheckoutState, GitFailure> | null;
  started: number;
  watch: Following | null;
  consumer: Fiber.Fiber<void> | null;
  watched: boolean;
  holders: number;
  released: number;
  stale: boolean;
};

export type GitCheckoutRows = CheckoutRows['Service'];

export const makeGitCheckoutRows = Effect.gen(function* () {
  const git = yield* Git;
  const roots = yield* FileRoots;
  const files = yield* FileSystem.FileSystem;
  const watches = yield* CheckoutWatch;
  const scope = yield* Effect.scope;
  const heads = yield* makeHeadWatches;
  const topology = yield* makeTopologyWatches;

  const held = new Map<string, RootState>();

  const gate = Semaphore.makeUnsafe(1);

  const readings = permits(READINGS);

  const trees = new Map<RootId, SharedTree>();

  const compared = new Map<string, Compared>();

  let runner: ((work: Effect.Effect<void>) => unknown) | null = null;

  let finalized = false;

  const listeners = new Set<(rootId: RootId, paths: readonly string[] | undefined) => Effect.Effect<void>>();

  const read = Effect.fn('CheckoutRows.read')(function* (
    rootId: RootId,
    base?: string,
  ): Effect.fn.Return<CheckoutState, RootResolutionFailure, Scope.Scope> {
    const asked = { rootId, base: base ?? null };
    const prior = held.get(keyOf(asked));
    const state = yield* hold(asked, false);
    yield* Deferred.await(state.first).pipe(Effect.withSpan('CheckoutRows.first'));
    if (prior === state && watchOf(rootId) === null) {
      const after = yield* request(state, 'polling-read');
      yield* Stream.runHead(SubscriptionRef.changes(state.finished).pipe(Stream.filter((finished) => finished >= after))).pipe(
        Effect.withSpan('CheckoutRows.polled'),
      );
    }
    return yield* SubscriptionRef.get(state.rows);
  }, Effect.scoped);

  const refresh = Effect.fn('CheckoutRows.refresh')(function* (
    rootId: RootId,
    base?: string,
  ): Effect.fn.Return<CheckoutState, RootResolutionFailure | GitFailure, Scope.Scope> {
    const state = yield* hold({ rootId, base: base ?? null }, false);
    const after = yield* request(state, 'refresh');
    yield* Stream.runHead(SubscriptionRef.changes(state.finished).pipe(Stream.filter((finished) => finished >= after))).pipe(
      Effect.withSpan('CheckoutRows.refreshed'),
    );
    if (state.result === null) return yield* Effect.die('the checkout rereading completed without its result');
    return yield* state.result;
  }, Effect.scoped);

  const subscribe = (rootId: RootId, base?: string): Stream.Stream<CheckoutState, RootResolutionFailure> =>
    Stream.unwrap(follow(rootId, base));

  const follow = (rootId: RootId, base?: string): Effect.Effect<Stream.Stream<CheckoutState>, RootResolutionFailure, Scope.Scope> =>
    Effect.map(hold({ rootId, base: base ?? null }, true), (state) =>
      SubscriptionRef.changes(state.rows).pipe(Stream.filter((row) => row.revision > 0)),
    );

  const onMark = (listener: (rootId: RootId, paths: readonly string[] | undefined) => Effect.Effect<void>): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const invalidate = (rootId: RootId, why: string, paths?: readonly string[]): Effect.Effect<void> => {
    const widened =
      paths === undefined ||
      paths.length === 0 ||
      paths.some(
        (path) =>
          path === '.' ||
          path === '..' ||
          path.startsWith('../') ||
          path.startsWith('/') ||
          /^[A-Za-z]:\//.test(path) ||
          WIDENING.test(path),
      );
    const affected = widened ? undefined : paths;
    const metadata = why === 'refs' || why === 'head' || why === 'operation';
    const told = metadata ? Effect.void : Effect.forEach(listeners, (listener) => listener(rootId, affected), { discard: true });
    const due = [...held.values()].filter((state) => state.rootId === rootId);
    if (due.length === 0) return told;
    const tree = shared.trees.get(rootId);
    if (tree !== undefined) {
      tree.epoch += 1;
      tree.why.add(why);
      if (!metadata) {
        if (affected === undefined) tree.paths = null;
        else if (tree.paths !== null) for (const path of affected) tree.paths.add(path);
      }
    }
    const started: Effect.Effect<void>[] = [];
    for (const state of due) {
      if (state.holders === 0) {
        drop(state);
        continue;
      }
      const start = wake(state, cycle(state), scope);
      if (start !== undefined) started.push(start);
    }
    return Effect.flatMap(told, () => Effect.forEach(started, (start) => start, { discard: true }));
  };

  const mark = (rootId: RootId, why = 'marked', paths?: readonly string[]): Effect.Effect<void> =>
    Effect.suspend(() => invalidate(rootId, why, paths));

  const request = (state: RootState, why: string): Effect.Effect<number> =>
    Effect.suspend(() => {
      const after = state.started + 1;
      return Effect.as(invalidate(state.rootId, why), after);
    });

  function hold(asked: CheckoutRowKey, follows: boolean): Effect.Effect<RootState, RootResolutionFailure, Scope.Scope> {
    return Effect.acquireRelease(take(asked, follows), (state) => give(state));
  }

  const take = Effect.fn('CheckoutRows.take')(function* (
    asked: CheckoutRowKey,
    follows: boolean,
  ): Effect.fn.Return<RootState, RootResolutionFailure> {
    const key = keyOf(asked);
    const observed = follows && asked.base === null;
    const taken = yield* gate.withPermit(
      Effect.gen(function* () {
        yield* finalizing();
        const lingering = held.get(key);
        if (lingering !== undefined && lingering.holders === 0 && !vouched(lingering)) drop(lingering);
        const standing = held.get(key);
        if (standing !== undefined) {
          standing.holders += 1;
          const opens = observed && !standing.watched;
          if (opens) standing.watched = true;
          return { state: standing, first: false, opens };
        }
        const root = yield* roots.read(asked.rootId);
        const tree = sharedTreeCell(shared.trees, asked.rootId);
        if (watchOf(asked.rootId) === null) {
          tree.epoch += 1;
          tree.why.add('opened');
          tree.paths = null;
        }
        const state: RootState = {
          rootId: asked.rootId,
          base: asked.base,
          key,
          dir: root.path,
          witness: root.witness,
          rows: yield* SubscriptionRef.make(unread(asked.rootId, root.path)),
          finished: yield* SubscriptionRef.make(0),
          result: null,
          started: 0,
          ...(yield* openRereading),
          watch: null,
          consumer: null,
          watched: observed,
          holders: 1,
          released: 0,
          stale: true,
        };
        held.set(key, state);
        return { state, first: true, opens: observed };
      }),
    );
    if (taken.opens) {
      const watching = yield* Effect.exit(observe(taken.state));
      if (watching._tag === 'Failure') {
        taken.state.watched = false;
        if (taken.first) yield* Effect.forkIn(cycle(taken.state), scope);
        yield* give(taken.state);
        return yield* Effect.failCause(watching.cause);
      }
    }
    if (!taken.first) {
      if (taken.opens) yield* mark(taken.state.rootId, 'watch-opened');
      return taken.state;
    }
    yield* Effect.forkIn(cycle(taken.state), scope);
    return taken.state;
  });

  function give(state: RootState): Effect.Effect<void> {
    return gate.withPermit(
      Effect.suspend(() => {
        state.holders -= 1;
        if (state.holders > 0) return Effect.void;
        if (held.get(state.key) !== state || !vouched(state)) {
          drop(state);
          return Effect.void;
        }
        state.released += 1;
        const release = state.released;
        const expire = gate.withPermit(
          Effect.sync(() => {
            if (state.holders === 0 && state.released === release) drop(state);
          }),
        );
        return Effect.asVoid(Effect.forkIn(Effect.andThen(Effect.sleep(LINGER), expire), scope));
      }),
    );
  }

  function vouched(state: RootState): boolean {
    return !state.dirty && !state.stale && watchOf(state.rootId) !== null;
  }

  function watchOf(rootId: RootId): Following | null {
    const watch = held.get(rootId)?.watch ?? null;
    return watch !== null && watch.watching() ? watch : null;
  }

  function unfollow(state: RootState): void {
    state.consumer?.interruptUnsafe();
    state.consumer = null;
    state.watch?.release();
    state.watch = null;
  }

  function drop(state: RootState): void {
    unfollow(state);
    if (held.get(state.key) !== state) return;
    held.delete(state.key);
    compared.delete(state.key);
    const rest = [...held.values()].filter((other) => other.rootId === state.rootId);
    if (state.base === null) for (const other of rest) if (other.holders === 0) drop(other);
    if (![...held.values()].some((other) => other.rootId === state.rootId)) shared.trees.delete(state.rootId);
  }

  function finalizing(): Effect.Effect<void> {
    if (finalized) return Effect.void;
    finalized = true;
    return Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        for (const state of held.values()) unfollow(state);
        held.clear();
        shared.trees.clear();
        compared.clear();
      }),
    );
  }

  const observe = Effect.fn('CheckoutRows.observe')(function* (state: RootState): Effect.fn.Return<void, RootResolutionFailure> {
    const following = yield* watches.follow(state.rootId);
    if (held.get(state.rootId) !== state) {
      following.release();
      return;
    }
    state.watch = following;
    const run = yield* running;
    state.consumer = yield* Effect.forkIn(
      Stream.runForEach(following.shifts, (shift) => Effect.sync(() => run(marked(state.rootId, shift)))),
      scope,
    );
  });

  const running: Effect.Effect<(work: Effect.Effect<void>) => unknown> = Effect.suspend(() =>
    runner !== null
      ? Effect.succeed(runner)
      : FiberSet.makeRuntime<never, void, never>().pipe(
          Scope.provide(scope),
          Effect.map((run) => (runner = run)),
        ),
  );

  function marked(rootId: RootId, shift: CheckoutShift): Effect.Effect<void> {
    if (shift.rescan !== null) return mark(rootId, shift.rescan);
    const named = [...shift.paths.keys()];
    return Effect.forEach(shift.movements, (movement) => mark(rootId, movement, movement === 'tree' ? named : undefined), {
      discard: true,
    });
  }

  function cycle(state: RootState): Effect.Effect<void> {
    return rereading(
      state,
      () => state.holders > 0 && held.get(state.key) === state,
      settle(state),
      () =>
        Effect.andThen(
          Effect.sync(() => {
            state.stale = true;
          }),
          SubscriptionRef.update(state.rows, (row) => ({ ...row, stale: true, revision: row.revision + 1 })),
        ),
    );
  }

  function refusedRow(state: RootState, standing: CheckoutState): Effect.Effect<CheckoutState> {
    const refused: CheckoutState = { ...standing, stale: true, incomplete: false };
    return Effect.match(outsideRepository(files, state.dir), {
      onFailure: () => refused,
      onSuccess: (outside) => (outside ? unversioned(standing, state.watch === null || !state.watch.watching()) : refused),
    });
  }

  const settle = Effect.fn('CheckoutRows.settle')(
    function* (state: RootState): Effect.fn.Return<Exit.Exit<CheckoutState, GitFailure>> {
      state.started += 1;
      const standing = yield* SubscriptionRef.get(state.rows);
      const result = yield* Effect.exit(readRow(shared, state, standing.revision));
      const next = yield* result.pipe(
        Effect.catchTags({
          GitAnswerInvalid: () => Effect.succeed({ ...standing, stale: true, incomplete: true }),
          GitUnreadable: () => Effect.succeed({ ...standing, stale: true, incomplete: false }),
          GitRefused: () => refusedRow(state, standing),
        }),
      );
      state.stale = next.stale || !next.repository;
      if (standing.revision > 0 && sameState(standing, next) && watchOf(state.rootId) !== null) {
        return Exit.map(result, () => standing);
      }
      const published = { ...next, revision: standing.revision + 1 };
      yield* SubscriptionRef.set(state.rows, published);
      return Exit.map(result, () => published);
    },
    (work, state) =>
      work.pipe(
        Effect.onExit((exit) =>
          Effect.andThen(
            Effect.sync(() => {
              state.result = exit._tag === 'Success' ? exit.value : Exit.failCause(exit.cause);
            }),
            SubscriptionRef.update(state.finished, (finished) => finished + 1),
          ),
        ),
        Effect.asVoid,
      ),
  );

  const shared: SharedReading = {
    git,
    files,
    readings,
    trees,
    compared,
    readerCountOf: (rootId) => {
      let readers = 0;
      for (const state of held.values()) if (state.rootId === rootId) readers += state.holders;
      return readers;
    },
    treeChanged: (rootId) => Effect.forEach(listeners, (listener) => listener(rootId, undefined), { discard: true }),
  };

  return CheckoutRows.of({ read, refresh, subscribe, follow, headMoved: heads.moved, checkoutsMoved: topology.moved, onMark, mark });
});
