import { Clock, Context, Effect, Fiber, type Scope } from 'effect';
import type { RootId } from '../workspace/contract/wire/ids.js';
import type { WorktreeActivity, WorktreeActKind, WorktreeActPhase } from './contract/wire/rows.js';
import type { ActProgress, Turns } from './contract/service/progress.js';

type Entry = {
  readonly id: number;
  readonly projectId: number;
  readonly rootId: RootId;
  readonly act: WorktreeActKind;
  readonly since: Date;
  phase: WorktreeActPhase | null;
};

type Cell = { readonly projectId: number; readonly act: WorktreeActKind; id: number | null };

const Acting = Context.Reference<ReadonlyMap<string, Cell>>('tagma/worktrees/ActProgress/Acting', {
  defaultValue: () => new Map(),
});

export const makeActProgress: Effect.Effect<ActProgress, never, Scope.Scope> = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const clock = yield* Clock.Clock;
  const entries = new Map<string, Entry[]>();
  const listeners = new Set<(projectId: number) => void>();
  const departing = new Map<string, number>();
  let minted = 0;

  const tell = (projectId: number): void => {
    for (const listener of listeners) listener(projectId);
  };

  const mark = (rootId: string, id: number, phase: WorktreeActPhase | null): void => {
    const standing = entries.get(rootId);
    const entry = standing?.find((one) => one.id === id);
    if (entry === undefined || entry.phase === phase) return;
    entry.phase = phase;
    if (standing?.[0] === entry) tell(entry.projectId);
  };

  const begin = (projectId: number, rootId: RootId, act: WorktreeActKind): number => {
    const id = ++minted;
    const entry: Entry = { id, projectId, rootId, act, since: new Date(clock.currentTimeMillisUnsafe()), phase: null };
    const standing = entries.get(rootId);
    if (standing !== undefined) {
      standing.push(entry);
      return id;
    }
    entries.set(rootId, [entry]);
    tell(projectId);
    return id;
  };

  const end = (rootId: string, id: number): void => {
    const standing = entries.get(rootId);
    if (standing === undefined) return;
    const at = standing.findIndex((entry) => entry.id === id);
    if (at < 0) return;
    const [ended] = standing.splice(at, 1);
    if (standing.length === 0) entries.delete(rootId);
    if (ended !== undefined && at === 0) tell(ended.projectId);
  };

  const detached = <A, E, R>(work: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.flatMap(Effect.forkIn(work, scope), Fiber.join);

  return {
    of: (projectId) => {
      const acts: WorktreeActivity[] = [];
      for (const standing of entries.values()) {
        const first = standing[0];
        if (first === undefined || first.projectId !== projectId) continue;
        acts.push({ rootId: first.rootId, act: first.act, phase: first.phase, since: first.since.toISOString() });
      }
      return acts;
    },
    leaving: (rootId) => departing.has(rootId) || entries.get(rootId)?.some((entry) => entry.act === 'clean') === true,
    departs: (rootId, work) =>
      Effect.acquireUseRelease(
        Effect.sync(() => departing.set(rootId, (departing.get(rootId) ?? 0) + 1)),
        () => work,
        () =>
          Effect.sync(() => {
            const left = (departing.get(rootId) ?? 1) - 1;
            if (left > 0) departing.set(rootId, left);
            else departing.delete(rootId);
          }),
      ),
    onMoved: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    during: (projectId, rootId, act, work, options = {}) =>
      Effect.flatMap(Acting, (acting) => {
        if (acting.has(rootId)) return work;
        return detached(
          Effect.acquireUseRelease(
            Effect.sync((): Cell => ({ projectId, act, id: options.deferred === true ? null : begin(projectId, rootId, act) })),
            (cell) => Effect.provideService(work, Acting, new Map(acting).set(rootId, cell)),
            (cell) =>
              Effect.sync(() => {
                if (cell.id !== null) end(rootId, cell.id);
              }),
          ),
        );
      }),
    detached,
    shown: (rootId) =>
      Effect.map(Acting, (acting) => {
        const cell = acting.get(rootId);
        if (cell !== undefined && cell.id === null) cell.id = begin(cell.projectId, rootId, cell.act);
      }),
    phase: (rootId, phase) =>
      Effect.map(Acting, (acting) => {
        const id = acting.get(rootId)?.id;
        if (id !== undefined && id !== null) mark(rootId, id, phase);
      }),
    queue: (projectId, rootIds, act) =>
      Effect.map(
        Effect.acquireRelease(
          Effect.sync(
            () =>
              new Map(
                rootIds.map((rootId) => {
                  const id = begin(projectId, rootId, act);
                  mark(rootId, id, 'waiting');
                  return [rootId as string, id] as const;
                }),
              ),
          ),
          (held) =>
            Effect.sync(() => {
              for (const [rootId, id] of held) end(rootId, id);
            }),
        ),
        (held): Turns => ({
          take: (rootId, work) => {
            const id = held.get(rootId);
            if (id === undefined) return work;
            const cell: Cell = { projectId, act, id };
            return Effect.ensuring(
              Effect.andThen(
                Effect.sync(() => mark(rootId, id, null)),
                Effect.flatMap(Acting, (acting) => Effect.provideService(work, Acting, new Map(acting).set(rootId, cell))),
              ),
              Effect.sync(() => end(rootId, id)),
            );
          },
        }),
      ),
  };
});
