import { flight } from '@runlith/held/Flight';
import { Cause, Effect, Exit, Scope } from 'effect';
import type { ProvedRoot, TargetAt } from '../../workspace/contract/wire/place.js';
import {
  type ThreadWorld,
  type WorldAcquisition,
  type WorldHost,
  type WorldLease,
  type WorldRequest,
  type WorldThread,
  Worlds,
  WorldUnavailable,
} from '../contract/service/worlds.js';

export type WorldLeasing = () => Effect.Effect<WorldLease>;

type WorldSources = {
  readonly checkout: (
    thread: WorldThread,
    root: string,
    projectId: number,
    runId: string,
    lease: WorldLeasing,
  ) => Effect.Effect<ThreadWorld, WorldUnavailable, Scope.Scope>;
  readonly hosts: readonly WorldHost[];
  readonly place: (root: string) => Effect.Effect<ProvedRoot | null>;
};

type Held = {
  readonly scope: Scope.Closeable;
  readonly root: string;
  readonly acquisition: WorldAcquisition;
  readonly claims: Set<object>;
};

export const makeLeasedWorlds = Effect.fnUntraced(function* (sources: WorldSources) {
  const held = new Map<string, Held>();
  const openingScope = yield* Scope.fork(yield* Effect.scope);
  const opening = yield* flight<string, WorldAcquisition, WorldUnavailable>({
    name: 'executions/world-opening',
    owner: 'executions',
    key: (key) => key,
    ceiling: '10 minutes',
  }).pipe(Scope.provide(openingScope));
  const condemned = new Set<string>();
  const retained = new Set<Held>();
  const hosts = new Map(sources.hosts.map((host) => [host.kind, host]));

  const closing = (standing: Held, named: string): Effect.Effect<void> =>
    Scope.close(standing.scope, Exit.void).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning('a world did not close; the release continues with the rest', {
          world: named,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const close = (key: string): Effect.Effect<void> =>
    Effect.suspend(() => {
      const standing = held.get(key);
      if (standing === undefined) return Effect.void;
      held.delete(key);
      if (standing.claims.size > 0) {
        retained.add(standing);
        return Effect.void;
      }
      return closing(standing, key);
    });

  const closeWhere = (matches: (key: string) => boolean): Effect.Effect<void> =>
    Effect.suspend(() => {
      for (const key of opening.standing()) if (matches(key)) condemned.add(key);
      return Effect.forEach([...held.keys()].filter(matches), close, { discard: true, concurrency: 1 });
    });

  const letGo = (standing: Held, claim: object): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (!standing.claims.delete(claim)) return Effect.void;
      if (standing.claims.size > 0) return Effect.void;
      if (!retained.delete(standing)) return Effect.void;
      return Scope.close(standing.scope, Exit.void);
    });

  const lease = Effect.fn('Worlds.lease')(function* (at: TargetAt) {
    const standing = held.get(keyOf(at));
    if (standing === undefined) {
      const ended = yield* Scope.make();
      yield* Scope.close(ended, Exit.void);
      return { scope: ended, release: Effect.void } satisfies WorldLease;
    }
    const claim = {};
    standing.claims.add(claim);
    return { scope: standing.scope, release: letGo(standing, claim) } satisfies WorldLease;
  });

  const open = (request: WorldRequest): Effect.Effect<ThreadWorld, WorldUnavailable, Scope.Scope> => {
    const { thread } = request;
    if (thread.hostKind === null) {
      return sources.checkout(thread, request.root, request.projectId, request.at.runId, () => lease(request.at));
    }
    const host = hosts.get(thread.hostKind);
    if (host === undefined) {
      return new WorldUnavailable({
        threadId: thread.id,
        hostKind: thread.hostKind,
        reason: `no host of kind ${thread.hostKind} is mounted on this server`,
      });
    }
    return host.world(thread);
  };

  const opened = Effect.fn('Worlds.opened')(function* (request: WorldRequest, key: string, standing: Held | undefined) {
    if (standing !== undefined) yield* close(key);
    const scope = yield* Scope.make();
    const acquisition = yield* Effect.interruptible(
      Effect.gen(function* () {
        const world = yield* open(request).pipe(Scope.provide(scope));
        const place = world.facts.shared ? yield* sources.place(world.root) : null;
        return { world, place } satisfies WorldAcquisition;
      }),
    ).pipe(
      Effect.onError(() =>
        Effect.suspend(() => {
          condemned.delete(key);
          return Scope.close(scope, Exit.void);
        }),
      ),
    );
    if (condemned.delete(key)) {
      yield* Scope.close(scope, Exit.void);
      return acquisition;
    }
    held.set(key, { scope, root: request.root, acquisition, claims: new Set() });
    return acquisition;
  }, Effect.uninterruptible);

  const worlds = Worlds.of({
    of: Effect.fn('Worlds.of')(function* (asked) {
      const { id, hostKind, hostId } = asked.thread;
      const request: WorldRequest = { thread: { id, hostKind, hostId }, at: asked.at, root: asked.root, projectId: asked.projectId };
      const key = keyOf(request.at);
      const standing = held.get(key);
      const opensAt = request.thread.hostKind === null ? request.root : null;
      if (standing !== undefined && (opensAt === null || standing.root === opensAt) && standing.acquisition.world.alive()) {
        return standing.acquisition;
      }
      return yield* opening.join(key, opened(request, key, standing)).pipe(
        Effect.mapError((failure) =>
          failure._tag === 'HoldStalled'
            ? new WorldUnavailable({
                threadId: request.thread.id,
                hostKind: request.thread.hostKind,
                reason: 'opening the world took longer than its ceiling',
              })
            : failure,
        ),
        Effect.catchTag('ReentrantCall', (reentered) => Effect.die(reentered)),
      );
    }),
    lease,
    release: Effect.fn('Worlds.release')(function* (at) {
      yield* close(keyOf(at));
    }),
    releaseRun: Effect.fn('Worlds.releaseRun')(function* (threadId, runId) {
      yield* closeWhere((key) => key.startsWith(`${threadId}\u0000${runId}\u0000`));
    }),
    drop: Effect.fn('Worlds.drop')(function* (threadId) {
      yield* closeWhere((key) => key.startsWith(`${threadId}\u0000`));
    }),
    closeAll: Effect.fn('Worlds.closeAll')(function* () {
      yield* closeWhere(() => true);
      const standing = [...retained];
      retained.clear();
      yield* Effect.forEach(standing, (held) => closing(held, held.root), { discard: true, concurrency: 1 });
    }),
  });
  yield* Effect.addFinalizer(() => Scope.close(openingScope, Exit.void).pipe(Effect.ensuring(worlds.closeAll())));
  return worlds;
});

const keyOf = (at: TargetAt): string => `${at.threadId}\u0000${at.runId}\u0000${at.generation}`;
