import { Effect, Exit, FiberSet, Layer, Scope } from 'effect';
import { carryCost } from '@runlith/performance/CostLedger';
import { type CopyPlace, ServedGraphs } from '../graph/contract/service/serving.js';
import { Projects } from '../projects/contract/service/registry.js';
import { ThreadRows } from '../threads/contract/service/rows.js';
import { ThreadPlacement } from '../threads/contract/service/placement.js';

type Hold = { readonly scope: Scope.Closeable; backing: string | null };

type Running = {
  readonly projectId: number;
  root: string | null;
  places: readonly CopyPlace[];
  readonly holds: Map<string, Hold>;
};

const keyOf = (place: CopyPlace): string => `${place.projectId}\u0000${place.checkout}`;

export const threadCopiesLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const rows = yield* ThreadRows;
    const graphs = yield* ServedGraphs;
    const placement = yield* ThreadPlacement;
    const projects = yield* Projects;
    const runFork = yield* FiberSet.makeRuntime<never, void, never>();
    const fork = (work: Effect.Effect<void>) => runFork(carryCost(work, 'ThreadCopies.hold'));
    const running = new Map<string, Running>();

    const drop = (standing: Running, key: string): void => {
      const hold = standing.holds.get(key);
      if (hold === undefined) return;
      standing.holds.delete(key);
      fork(Scope.close(hold.scope, Exit.void));
    };

    const take = (standing: Running, place: CopyPlace): void => {
      const key = keyOf(place);
      if (standing.holds.has(key)) return;
      const hold: Hold = { scope: Scope.makeUnsafe(), backing: null };
      standing.holds.set(key, hold);
      fork(
        Effect.flatMap(Scope.provide(graphs.holdServed(place), hold.scope), (held) =>
          Effect.sync(() => {
            if (standing.holds.get(key) !== hold) return;
            if (held === null) drop(standing, key);
            else hold.backing = held.checkout;
          }),
        ),
      );
    };

    const placesOf = Effect.fnUntraced(function* (threadId: string, projectId: number) {
      const roots = yield* placement.rootsOf(threadId);
      if (roots.length > 0) return roots.map((root) => ({ projectId, checkout: root.path }));
      return [{ projectId, checkout: (yield* projects.byId(projectId)).rootPath }];
    });

    const placed = (threadId: string, standing: Running): void => {
      const root = standing.root;
      fork(
        Effect.gen(function* () {
          const named = yield* Effect.exit(placesOf(threadId, standing.projectId));
          if (Exit.isFailure(named)) {
            return yield* Effect.logWarning(
              'the copies a running thread stands in could not be named, so the pool keeps them only by use',
              {
                threadId,
                cause: named.cause,
              },
            );
          }
          if (running.get(threadId) !== standing || standing.root !== root) return;
          standing.places = named.value;
          const wanted = new Set(named.value.map(keyOf));
          for (const key of [...standing.holds.keys()]) if (!wanted.has(key)) drop(standing, key);
          for (const place of named.value) take(standing, place);
        }),
      );
    };

    const ended = (threadId: string): void => {
      const standing = running.get(threadId);
      if (standing === undefined) return;
      running.delete(threadId);
      for (const key of [...standing.holds.keys()]) drop(standing, key);
    };

    const follow = (): void => {
      const active = rows.activities();
      for (const threadId of [...running.keys()]) if (!active.has(threadId)) ended(threadId);
      for (const [threadId, activity] of active) {
        if (activity.projectId === null) {
          ended(threadId);
          continue;
        }
        const standing = running.get(threadId);
        if (standing !== undefined && standing.root === activity.rootId) continue;
        const next = standing ?? { projectId: activity.projectId, root: activity.rootId, places: [], holds: new Map() };
        next.root = activity.rootId;
        running.set(threadId, next);
        placed(threadId, next);
      }
    };

    const detach = rows.subscribe((batch) => {
      if (batch.activity) follow();
    });
    follow();

    const unsubscribe = graphs.copies.subscribe((event) => {
      for (const standing of running.values()) {
        if (standing.projectId !== event.projectId) continue;
        if (event.kind === 'opened') {
          for (const place of standing.places) take(standing, place);
          continue;
        }
        for (const [key, hold] of [...standing.holds]) if (hold.backing === null || hold.backing === event.checkout) drop(standing, key);
      }
    });

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        detach();
        unsubscribe();
        for (const threadId of [...running.keys()]) ended(threadId);
      }),
    );
  }),
);
