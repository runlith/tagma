import { Effect, Exit, Option, Queue, Scope, Stream } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { FileRoots } from '../../workspace/contract/service/roots.js';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import { isRootFailure, type RootResolutionFailure } from '../../workspace/contract/wire/roots.js';
import type { HeldFeed } from '../contract/service/held.js';
import { ThreadChanges } from '../contract/service/threadChanges.js';
import type { KnownOutcomes } from '../contract/service/record.js';
import type { HoldingsState, LineCounts } from '../contract/wire/holdings.js';
import type {
  ChangeCommit,
  LineEnd,
  ThreadChangesFrame,
  ThreadCheckout,
  ThreadCheckoutChange,
  ThreadEntry,
} from '../contract/wire/threadChanges.js';
import type { Judges } from '../holdings/judges.js';
import { commitsOf, type CommitReaders, type CommitsKept } from './commits.js';
import { endedOf, entryOf } from './entries.js';
import { checkoutsOfThread } from '../record/reads.js';

export type ChangeReaders = CommitReaders & {
  readonly roots: FileRoots['Service'];
  readonly checkouts: CheckoutRows['Service'];
  readonly paths: CheckoutPaths['Service'];
};

type Side = {
  readonly rootId: RootId;
  readonly scope: Scope.Closeable;
  projectId: number | null;
  unplaced: string | null;
  root: string;
  branch: string | null;
  head: string | null;
  revision: number;
  unwatched: string | null;
  unread: string | null;
  sent: string;
  fresh: boolean;
  readonly listed: Map<string, ThreadEntry>;
  readonly uncommitted: { added: number; removed: number };
  readonly pending: Map<string, ThreadEntry | null>;
};

const weightOf = (entry: ThreadEntry | undefined): LineCounts | null =>
  entry?.section === 'uncommitted' && entry.lines !== 'unweighed' ? entry.lines : null;

const relist = (side: Side, path: string, entry: ThreadEntry | null): boolean => {
  const before = weightOf(side.listed.get(path));
  if (before !== null) {
    side.uncommitted.added -= before.added;
    side.uncommitted.removed -= before.removed;
  }
  if (entry === null) return side.listed.delete(path);
  side.listed.set(path, entry);
  const after = weightOf(entry);
  if (after !== null) {
    side.uncommitted.added += after.added;
    side.uncommitted.removed += after.removed;
  }
  return true;
};

const summed = (sides: Iterable<Side>): LineCounts => {
  const total = { added: 0, removed: 0 };
  for (const side of sides) {
    total.added += side.uncommitted.added;
    total.removed += side.uncommitted.removed;
  }
  return total;
};

type Measured = { readonly revision: number; readonly state: HoldingsState };

type Commits = { readonly list: readonly ChangeCommit[]; readonly more: boolean };

const stateKey = (state: HoldingsState, revision: number, branch: string | null): string =>
  `${state.kind}:${state.kind === 'stale' ? state.reason : state.kind === 'judging' || state.kind === 'opening' ? state.paths : ''}:${revision}:${branch}`;

const stateOf = (side: Side, state: HoldingsState): HoldingsState => {
  const reason = side.unread ?? side.unwatched ?? side.unplaced;
  return reason === null || state.kind === 'stale' ? state : { kind: 'stale', reason };
};

const unreadable = (side: Side, failure: RootResolutionFailure): Measured => {
  side.unread = failure.message;
  if (failure.path !== undefined) side.root = failure.path;
  return { revision: side.revision, state: { kind: 'stale', reason: failure.message } };
};

export const threadChangesOver = (
  judges: Judges,
  held: HeldFeed['Service'],
  readers: ChangeReaders,
  kept: CommitsKept,
): ThreadChanges['Service'] => {
  const subscribe = (projectId: number, threadId: string, home: RootId | null, limit: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const wake = yield* Queue.sliding<void>(1);
        const ring = Effect.asVoid(Queue.offer(wake, undefined));
        const sides = new Map<string, Side>();
        const arriving = new Set<RootId>();
        let stamped = true;
        let commitsDirty = true;

        const watch = (side: Side): Effect.Effect<void> => {
          const watched = Stream.runForEach(readers.checkouts.subscribe(side.rootId), (row) => {
            if (side.branch === row.ref) return Effect.void;
            side.branch = row.ref;
            return ring;
          });
          return Effect.asVoid(
            Effect.forkIn(
              Effect.flatMap(Effect.result(watched), (ended) => {
                if (ended._tag === 'Success') return Effect.void;
                side.unwatched = ended.failure.message;
                return ring;
              }),
              side.scope,
            ),
          );
        };

        const open = Effect.fnUntraced(function* (rootId: RootId): Effect.fn.Return<void, StoreFailure> {
          if (sides.has(rootId)) return;
          const side: Side = {
            rootId,
            scope: yield* Scope.fork(scope),
            projectId: null,
            unplaced: null,
            root: rootId,
            branch: null,
            head: null,
            revision: 0,
            unwatched: null,
            unread: null,
            sent: '',
            fresh: true,
            listed: new Map(),
            uncommitted: { added: 0, removed: 0 },
            pending: new Map(),
          };
          sides.set(rootId, side);
          const located = yield* Effect.result(readers.paths.rootAcross(rootId, projectId));
          if (located._tag === 'Success') side.projectId = located.success?.projectId ?? null;
          else side.unplaced = `the project this checkout belongs to could not be told: ${located.failure.reason}`;
          yield* Effect.gen(function* () {
            const root = yield* readers.roots.read(rootId);
            yield* Scope.provide(judges.hold(rootId), side.scope);
            const view = yield* judges.read(rootId);
            side.root = root.path;
            side.head = view.head;
            side.revision = view.revision;
            for (const holding of view.paths) {
              const entry = entryOf(holding, threadId);
              if (entry !== null) relist(side, entry.path, entry);
            }
            yield* watch(side);
          }).pipe(Effect.catchIf(isRootFailure, (failure) => Effect.sync(() => void unreadable(side, failure))));
        });

        const measure = (side: Side): Effect.Effect<Measured, StoreFailure> =>
          side.unread !== null
            ? Effect.succeed<Measured>({ revision: side.revision, state: { kind: 'stale', reason: side.unread } })
            : judges.meta(side.rootId).pipe(
                Effect.map((meta): Measured => {
                  if (meta.head !== side.head) {
                    side.head = meta.head;
                    commitsDirty = true;
                  }
                  side.revision = meta.revision;
                  return { revision: meta.revision, state: stateOf(side, meta.state) };
                }),
                Effect.catchIf(isRootFailure, (failure) => Effect.sync(() => unreadable(side, failure))),
              );

        const measured = Effect.suspend(() =>
          Effect.map(
            Effect.forEach([...sides.values()], (side) => Effect.map(measure(side), (one) => [side, one] as const)),
            (pairs) => new Map<Side, Measured>(pairs),
          ),
        );

        const departed = Effect.gen(function* () {
          const asked = [...sides.values()].filter((side) => side.rootId !== home);
          if (asked.length === 0) return [];
          const holding = new Set(yield* judges.checkoutsOf([threadId]));
          const gone: RootId[] = [];
          for (const side of asked) {
            if (holding.has(side.rootId)) continue;
            const removed = yield* Effect.result(readers.roots.removed(side.rootId));
            if (removed._tag === 'Failure') {
              yield* Effect.logWarning('a checkout stays in the thread changes: whether it was removed could not be read', {
                checkout: side.rootId,
                reason: removed.failure.message,
              });
              continue;
            }
            if (!removed.success) continue;
            sides.delete(side.rootId);
            gone.push(side.rootId);
            yield* Scope.close(side.scope, Exit.void);
          }
          if (gone.length > 0) commitsDirty = true;
          return gone;
        });

        const stopChanges = judges.changed((change) => {
          const side = sides.get(change.checkout);
          if (side === undefined) {
            if (!change.changed.some((holding) => entryOf(holding, threadId) !== null)) return Effect.void;
            arriving.add(change.checkout);
            return ring;
          }
          let moved = false;
          for (const holding of change.changed) {
            const entry = entryOf(holding, threadId);
            if (entry !== null) {
              relist(side, holding.path, entry);
              side.pending.set(holding.path, entry);
              moved = true;
            } else if (relist(side, holding.path, null)) {
              side.pending.set(holding.path, null);
              moved = true;
            }
          }
          for (const path of change.gone)
            if (relist(side, path, null)) {
              side.pending.set(path, null);
              moved = true;
            }
          return moved ? ring : Effect.void;
        });
        const stopStates = judges.stated((checkout) => (sides.has(checkout) ? ring : Effect.void));
        const stopHeld = held.heldChanged((change) => {
          if (change.threadId !== threadId) return Effect.void;
          stamped = true;
          if (change.outcomes) commitsDirty = true;
          return ring;
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            stopChanges();
            stopStates();
            stopHeld();
          }),
        );

        const places = yield* checkoutsOfThread(readers.units, readers.store, projectId, threadId);
        for (const place of new Set([...(home === null ? [] : [home]), ...places])) yield* open(RootId.make(place));
        yield* departed;

        let ends: readonly LineEnd[] = [];
        let stamp = '';
        const ended = Effect.gen(function* () {
          const read = yield* endedOf(readers.units, readers.store, projectId, threadId);
          if (read.stamp === stamp) return false;
          stamp = read.stamp;
          ends = read.ends;
          commitsDirty = true;
          return true;
        });

        let commits: Commits = { list: [], more: false };
        let outcomes: KnownOutcomes = { commits: [], unread: [] };
        const listed = Effect.gen(function* () {
          if (!commitsDirty) return false;
          commitsDirty = false;
          const read = yield* Effect.forEach(
            [...sides.values()].filter((side) => side.unread === null),
            (side) => commitsOf(readers, kept, { rootId: side.rootId, placed: side.projectId, projectId, threadId, limit, dir: side.root }),
          );
          outcomes = {
            commits: read.flatMap((one) => one.outcomes.commits),
            unread: [
              ...[...sides.values()].flatMap((side) => (side.unread === null ? [] : [{ checkout: side.rootId, reason: side.unread }])),
              ...read.flatMap((one) => one.outcomes.unread),
            ],
          };
          for (const one of outcomes.unread) {
            const side = sides.get(RootId.make(one.checkout));
            if (side !== undefined) {
              side.unread = one.reason;
              for (const path of side.listed.keys()) side.pending.set(path, null);
              side.listed.clear();
              side.uncommitted.added = 0;
              side.uncommitted.removed = 0;
            }
          }
          const all = read
            .flatMap((one) => one.commits)
            .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
          commits = { list: all.slice(0, limit), more: all.length > limit || read.some((one) => one.more) };
          return true;
        });

        stamped = false;
        yield* ended;
        const opening = yield* measured;
        yield* listed;
        const checkouts: ThreadCheckout[] = [];
        for (const [side, one] of opening) {
          side.fresh = false;
          side.pending.clear();
          side.sent = stateKey(stateOf(side, one.state), one.revision, side.branch);
          checkouts.push({
            checkout: side.rootId,
            projectId: side.projectId,
            root: side.root,
            branch: side.branch,
            revision: one.revision,
            state: stateOf(side, one.state),
            uncommitted: { ...side.uncommitted },
            entries: [...side.listed.values()],
          });
        }
        const whole: ThreadChangesFrame = {
          kind: 'whole',
          threadId,
          held: judges.held(threadId),
          uncommitted: summed(sides.values()),
          checkouts,
          commits: commits.list,
          moreCommits: commits.more,
          ends,
        };

        const next = Effect.gen(function* () {
          for (;;) {
            yield* Queue.take(wake);
            for (const rootId of [...arriving]) {
              arriving.delete(rootId);
              yield* open(rootId);
            }
            const moved = stamped;
            stamped = false;
            const endsMoved = moved ? yield* ended : false;
            const gone = moved ? yield* departed : [];
            const now = yield* measured;
            const commitsMoved = yield* listed;
            const changed: ThreadCheckoutChange[] = [];
            for (const [side, one] of now) {
              const key = stateKey(one.state, one.revision, side.branch);
              if (!side.fresh && side.pending.size === 0 && key === side.sent) continue;
              const entries = side.fresh ? [...side.listed.values()] : [...side.pending.values()].filter((entry) => entry !== null);
              const left = side.fresh ? [] : [...side.pending].flatMap(([path, entry]) => (entry === null ? [path] : []));
              side.fresh = false;
              side.pending.clear();
              side.sent = key;
              changed.push({
                checkout: side.rootId,
                projectId: side.projectId,
                root: side.root,
                branch: side.branch,
                revision: one.revision,
                state: stateOf(side, one.state),
                uncommitted: { ...side.uncommitted },
                changed: entries,
                gone: left,
              });
            }
            if (changed.length === 0 && gone.length === 0 && !endsMoved && !commitsMoved) continue;
            const frame: ThreadChangesFrame = {
              kind: 'change',
              threadId,
              held: judges.held(threadId),
              uncommitted: summed(sides.values()),
              checkouts: changed,
              gone,
              commits: commitsMoved ? { list: commits.list, more: commits.more } : undefined,
              ends: endsMoved ? ends : undefined,
            };
            return { frame, outcomes };
          }
        });
        return Stream.concat(Stream.make({ frame: whole, outcomes }), Stream.fromEffectRepeat(next));
      }),
    );
  return ThreadChanges.of({
    subscribe: (...args) => Stream.map(subscribe(...args), (one) => one.frame),
    read: Effect.fn('ThreadChanges.read')(function* (projectId, threadId, home, limit) {
      const places = new Set([...(home === null ? [] : [home]), ...(yield* judges.checkoutsOf([threadId]))]);
      const first = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.forEach(
            places,
            (place) =>
              Effect.andThen(judges.hold(RootId.make(place)), judges.settled(RootId.make(place))).pipe(
                Effect.catchIf(isRootFailure, () => Effect.void),
              ),
            { discard: true },
          );
          return yield* Stream.runHead(subscribe(projectId, threadId, home, limit));
        }),
      );
      if (Option.isSome(first) && first.value.frame.kind === 'whole') return { ...first.value.frame, outcomes: first.value.outcomes };
      return yield* Effect.die(new Error('thread.changes opened with no whole frame'));
    }),
  });
};
