import { Cause, Effect, Exit, Queue, Scope, Stream } from 'effect';
import type { WorktreeActivity } from '../contract/wire/rows.js';
import type { ActProgress } from '../contract/service/progress.js';
import type { ThreadsMoved } from '../contract/service/finishingGate.js';
import { type FeedReads, type Frames, makeFeedMembership, type WorktreeFeedFailure } from './membership.js';
import { makePublish } from './publication.js';

import type { ProjectMoved } from '../contract/service/listing.js';

export type FeedOptions = {
  readonly pendingMoved?: ProjectMoved;
  readonly progress?: ActProgress;
  readonly visible: () => ReadonlySet<string>;
  readonly held: () => ReadonlySet<string>;
  readonly interestsMoved: (listener: () => void) => () => void;
  readonly heldMoved?: ProjectMoved;
};

type Source = 'record' | 'pending' | 'act' | 'thread' | 'checkout' | 'check' | 'interest' | 'state';

type Dirt = {
  readonly events: Record<Source, number>;
  readonly roots: Set<string>;
  readonly acted: Set<string>;
  readonly threads: Set<string>;
  everyThread: boolean;
  metadata: boolean;
};

const clean = (): Dirt => ({
  events: { record: 0, pending: 0, act: 0, thread: 0, checkout: 0, check: 0, interest: 0, state: 0 },
  roots: new Set(),
  acted: new Set(),
  threads: new Set(),
  everyThread: false,
  metadata: false,
});

export type WorktreeFeed = { readonly run: (frames: Frames) => Effect.Effect<void, WorktreeFeedFailure, Scope.Scope> };

export const makeWorktreeFeed = (input: {
  readonly projectId: number;
  readonly reads: FeedReads;
  readonly recorded: ProjectMoved;
  readonly threadsMoved: ThreadsMoved;
  readonly options?: FeedOptions;
}): WorktreeFeed => {
  const { projectId, reads, recorded, threadsMoved } = input;
  const { pendingMoved, progress } = input.options ?? {};
  const visible = input.options?.visible ?? (() => new Set<string>());
  const held = input.options?.held ?? (() => new Set<string>());
  let dirt: Dirt = clean();
  let shownActs: ReadonlyMap<string, WorktreeActivity> = new Map();
  const lingering = new Map<string, number>();
  let actMoves = 0;
  let actsSent = false;
  let wake: Queue.Queue<void> | null = null;
  let topology: { readonly path: string; readonly scope: Scope.Closeable } | undefined;

  const poke = (source: Source, rootId?: string, metadata = false): void => {
    dirt.events[source] += 1;
    if (metadata) dirt.metadata = true;
    if (rootId !== undefined) dirt.roots.add(rootId);
    if (wake !== null) Queue.offerUnsafe(wake, undefined);
  };

  const observeTopology = Effect.fnUntraced(function* (path: string | undefined, scope: Scope.Scope) {
    if (topology?.path === path) return;
    if (topology !== undefined) yield* Scope.close(topology.scope, Exit.void);
    topology = undefined;
    if (path === undefined) return;
    const own = yield* Scope.fork(scope);
    topology = { path, scope: own };
    yield* Effect.forkIn(
      Stream.runForEach(Stream.drop(reads.topology(path), 1), (event) =>
        event.watching ? Effect.sync(() => poke('record')) : Effect.void,
      ),
      own,
    );
  });

  const acting = (): ReadonlySet<string> => new Set(progress?.of(projectId).map((act) => act.rootId as string) ?? []);

  const membership = makeFeedMembership({
    reads,
    poke: (rootId, metadata) => poke('checkout', rootId, metadata),
    changed: () => poke('state'),
    leaving: (rootId) => progress?.leaving(rootId) === true,
    visible,
    held,
  });
  const { trees, rowsMoved } = membership.state;
  const publish = makePublish({ membership, acting });

  const sendActs = (frames: Frames): void => {
    if (progress === undefined) return;
    const next = new Map(progress.of(projectId).map((act) => [act.rootId as string, act]));
    for (const [rootId, act] of shownActs) {
      if (next.has(rootId)) lingering.delete(rootId);
      else if (lingering.has(rootId)) next.set(rootId, act);
    }
    if (actsSent && JSON.stringify([...next]) === JSON.stringify([...shownActs])) return;
    actsSent = true;
    shownActs = next;
    Queue.offerUnsafe(frames, { kind: 'acts', acts: [...next.values()] });
  };

  const actMoved = (frames: Frames): void => {
    if (progress === undefined) return;
    actMoves += 1;
    const live = new Set(progress.of(projectId).map((act) => act.rootId as string));
    for (const rootId of live) if (progress.leaving(rootId)) dirt.acted.add(rootId);
    for (const rootId of shownActs.keys()) {
      if (live.has(rootId)) continue;
      if (!lingering.has(rootId)) lingering.set(rootId, actMoves);
      dirt.acted.add(rootId);
    }
    sendActs(frames);
    poke('act');
  };

  const settled = <E>(frames: Frames, work: Effect.Effect<void, E>): Effect.Effect<void, E> =>
    Effect.suspend(() => {
      const cut = actMoves;
      return Effect.ensuring(
        work,
        Effect.sync(() => {
          for (const [rootId, ended] of lingering) if (ended <= cut) lingering.delete(rootId);
          sendActs(frames);
        }),
      );
    });

  const step = (source: Source, events: number, work: Effect.Effect<void, WorktreeFeedFailure>): Effect.Effect<void, WorktreeFeedFailure> =>
    Effect.withSpan(work, `WorktreeFeed.${source}`, { root: true, attributes: { project: projectId, events } });

  const open = Effect.fn('WorktreeFeed.open', { root: true, attributes: { project: projectId } })(function* (
    frames: Frames,
    scope: Scope.Scope,
  ) {
    const before = acting();
    const [current, placings] = yield* Effect.all([reads.membership(projectId), reads.placings(projectId)], {
      concurrency: 3,
    });
    const built = yield* membership.reconcile(current);
    yield* observeTopology(current.canonical?.path, scope);
    membership.placeAll(placings);
    yield* publish(frames, before);
    sendActs(frames);
    yield* membership.resighted([...built], new Set(), scope);
    yield* publish(frames, before);
  });

  const pass = Effect.fnUntraced(function* (frames: Frames, scope: Scope.Scope) {
    const batch = dirt;
    dirt = clean();
    const before = acting();
    const seen = new Set<string>();
    const { record, pending, act, thread, checkout, check, interest } = batch.events;
    if (record > 0) {
      yield* step(
        'record',
        record,
        Effect.gen(function* () {
          const current = yield* reads.membership(projectId);
          yield* membership.reconcile(current);
          yield* observeTopology(current.canonical?.path, scope);
          if (checkout === 0) yield* membership.resighted([...trees.keys()], seen, scope);
        }),
      );
    } else if (pending > 0) {
      yield* step(
        'pending',
        pending,
        Effect.map(reads.pending(projectId), (merges) => {
          for (const [rootId, tree] of trees) {
            if (tree.kind !== 'tagma') continue;
            const next = merges.get(rootId) ?? null;
            if (JSON.stringify(next) === JSON.stringify(tree.pending)) continue;
            tree.pending = next;
            rowsMoved.add(rootId);
          }
        }),
      );
    }
    if (act > 0) {
      yield* step(
        'act',
        act,
        Effect.gen(function* () {
          const acted = [...batch.acted].filter((rootId) => trees.has(rootId) && !seen.has(rootId));
          for (const rootId of acted) rowsMoved.add(rootId);
          yield* membership.resighted(acted, seen, scope, 'fresh');
        }),
      );
    }
    if (thread > 0) {
      const placed = batch.everyThread
        ? Effect.map(reads.placings(projectId), membership.placeAll)
        : Effect.map(reads.placings(projectId, [...batch.threads]), (read) => {
            const named = new Map(read.map((one) => [one.threadId, one]));
            for (const threadId of batch.threads) membership.placeOne(threadId, named.get(threadId));
          });
      yield* step('thread', thread, Effect.andThen(placed, membership.checkBusy(scope)));
    }
    if (checkout > 0) {
      yield* step(
        'checkout',
        checkout,
        Effect.gen(function* () {
          if (record === 0 && batch.metadata) {
            const current = yield* reads.membership(projectId);
            yield* membership.reconcile(current);
            yield* observeTopology(current.canonical?.path, scope);
          }
          yield* membership.treesMoved(batch.roots, seen, scope);
        }),
      );
    }
    if (check > 0) yield* step('check', check, membership.measureMoved);
    if (interest > 0) yield* step('interest', interest, membership.checkBusy(scope));
    if (rowsMoved.size > 0 || membership.state.strayed) yield* publish(frames, before);
  });

  return {
    run: Effect.fnUntraced(function* (frames: Frames) {
      const scope = yield* Effect.scope;
      const woken = yield* Queue.sliding<void>(1);
      wake = woken;
      const detach = [
        recorded((moved) => {
          if (moved === projectId) poke('record');
        }),
        threadsMoved(projectId, (threadId) => {
          if (threadId === null) dirt.everyThread = true;
          else dirt.threads.add(threadId);
          poke('thread');
        }),
        pendingMoved?.((moved) => {
          if (moved === projectId) poke('pending');
        }) ?? (() => undefined),
        progress?.onMoved((moved) => {
          if (moved === projectId) actMoved(frames);
        }) ?? (() => undefined),
        input.options?.interestsMoved(() => poke('interest')) ?? (() => undefined),
        input.options?.heldMoved?.((moved) => {
          if (moved === projectId) poke('interest');
        }) ?? (() => undefined),
        reads.checked((path) => {
          for (const tree of trees.values()) if (tree.kind === 'tagma' && tree.record.path === path) return poke('check');
        }),
      ];
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const release of detach) release();
        }),
      );
      const opened = yield* Effect.result(settled(frames, open(frames, scope)));
      if (opened._tag === 'Failure') {
        yield* Queue.fail(frames, opened.failure);
        return;
      }
      yield* Effect.forkIn(
        Effect.forever(Queue.take(woken).pipe(Effect.andThen(settled(frames, pass(frames, scope))))).pipe(
          Effect.onError((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Queue.failCause(frames, cause))),
        ),
        scope,
      );
    }),
  };
};
