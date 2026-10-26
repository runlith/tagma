import { type Clock, Context, Deferred, Effect } from 'effect';
import { figures, type Machine, thisMachine } from '../../platform/contract/service/capacity.js';
import type { CopyEvent, CopyPlace, HeldGraph, ServedCopy } from '../contract/service/serving.js';

const COPY_ENVELOPE = 256 * 1024 ** 2;
const KEPT_PER_COPY_MS = 30_000;
const KEPT_FLOOR_MS = 60_000;
const KEPT_CEILING_MS = 10 * 60_000;

export type Keeping = { readonly idle: number; readonly ms: number };

export const keepingOf = (machine: Machine): Keeping => {
  const idle = Math.max(2, Math.floor((0.25 * figures(machine).serverMemory) / COPY_ENVELOPE));
  const pace = 8 / Math.min(16, Math.max(4, machine.parallelism));
  return { idle, ms: Math.min(KEPT_CEILING_MS, Math.max(KEPT_FLOOR_MS, Math.round(KEPT_PER_COPY_MS * idle * pace))) };
};

export const CopyKeeping = Context.Reference<Keeping>('tagma/graph/CopyKeeping', { defaultValue: () => keepingOf(thisMachine()) });

export type Copy = {
  readonly treeRoot: string;
  readonly graph: HeldGraph;
  readonly generation: number;
  readonly detachedAt: string | null;
  holds: number;
  lastUse: number;
  waking: boolean;
};

type Project = {
  generation: number;
  changing: Deferred.Deferred<void> | null;
  readonly openings: Set<Deferred.Deferred<void>>;
};

export type Opening = { readonly generation: number; readonly done: () => void };

export const makeCopies = (input: {
  readonly keeping: Keeping;
  readonly clock: Clock.Clock;
  readonly fork: (effect: Effect.Effect<void>) => void;
  readonly lapse: (copy: Copy) => Effect.Effect<void>;
}) => {
  const { keeping, clock, fork, lapse } = input;
  const standing = new Map<string, Copy>();
  const projects = new Map<number, Project>();
  const subscribers = new Set<(event: CopyEvent) => void>();

  const now = () => clock.currentTimeMillisUnsafe();

  const servedOf = (copy: Copy): ServedCopy => ({
    projectId: copy.graph.projectId,
    checkout: copy.graph.checkout,
    treeRoot: copy.treeRoot,
  });

  const tell = (kind: CopyEvent['kind'], copy: Copy): void => {
    for (const subscriber of [...subscribers]) subscriber({ kind, ...servedOf(copy) });
  };

  const projectOf = (projectId: number): Project => {
    const known = projects.get(projectId);
    if (known !== undefined) return known;
    const made: Project = { generation: 0, changing: null, openings: new Set() };
    projects.set(projectId, made);
    return made;
  };

  const resting = (): Copy[] => [...standing.values()].filter((copy) => copy.holds === 0).sort((a, b) => a.lastUse - b.lastUse);

  const lapsed = (copy: Copy): boolean => {
    if (standing.get(copy.treeRoot) !== copy || copy.holds > 0) return false;
    if (now() >= copy.lastUse + keeping.ms) return true;
    const idle = resting();
    return idle.indexOf(copy) < idle.length - keeping.idle;
  };

  const rebalance = (): void => {
    for (const copy of resting()) if (lapsed(copy)) fork(lapse(copy));
  };

  const watch = (copy: Copy): void => {
    if (copy.waking) return;
    copy.waking = true;
    fork(
      Effect.gen(function* () {
        for (;;) {
          if (standing.get(copy.treeRoot) !== copy || copy.holds > 0) return;
          if (lapsed(copy)) yield* lapse(copy);
          else yield* Effect.sleep(copy.lastUse + keeping.ms - now());
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            copy.waking = false;
          }),
        ),
      ),
    );
  };

  const use = (copy: Copy): void => {
    copy.lastUse = now();
    if (copy.holds === 0) watch(copy);
  };

  const hold = (copy: Copy): (() => void) => {
    copy.holds += 1;
    copy.lastUse = now();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      copy.holds -= 1;
      copy.lastUse = now();
      if (copy.holds > 0) return;
      watch(copy);
      rebalance();
    };
  };

  const publish = (treeRoot: string, graph: HeldGraph, generation: number, detachedAt: string | null): Copy => {
    const copy: Copy = { treeRoot, graph, generation, detachedAt, holds: 0, lastUse: now(), waking: false };
    standing.set(treeRoot, copy);
    tell('opened', copy);
    rebalance();
    return copy;
  };

  const unpublish = (copy: Copy): boolean => {
    if (standing.get(copy.treeRoot) !== copy) return false;
    standing.delete(copy.treeRoot);
    return true;
  };

  const current = (copy: Copy): boolean =>
    standing.get(copy.treeRoot) === copy && projectOf(copy.graph.projectId).generation === copy.generation;

  const admitted = Effect.fnUntraced(function* (projectId: number) {
    const project = projectOf(projectId);
    while (project.changing !== null) yield* Deferred.await(project.changing);
    const done = Deferred.makeUnsafe<void>();
    project.openings.add(done);
    const opening: Opening = {
      generation: project.generation,
      done: () => {
        project.openings.delete(done);
        Deferred.doneUnsafe(done, Effect.void);
      },
    };
    return opening;
  });

  const exclusive = <A, E, R>(projectId: number, act: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const project = projectOf(projectId);
        while (project.changing !== null) yield* restore(Deferred.await(project.changing));
        const mark = Deferred.makeUnsafe<void>();
        project.changing = mark;
        return yield* Effect.gen(function* () {
          for (const opening of [...project.openings]) yield* restore(Deferred.await(opening));
          return yield* restore(act);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              project.changing = null;
              Deferred.doneUnsafe(mark, Effect.void);
            }),
          ),
        );
      }),
    );

  const letGo = (projectId: number): readonly Copy[] => {
    projectOf(projectId).generation += 1;
    return [...standing.values()].filter((copy) => copy.graph.projectId === projectId);
  };

  return {
    at: (treeRoot: string): Copy | undefined => standing.get(treeRoot),
    of: (place: CopyPlace): Copy | undefined =>
      [...standing.values()].find((copy) => copy.graph.projectId === place.projectId && copy.graph.checkout === place.checkout),
    all: (): readonly Copy[] => [...standing.values()],
    held: (): readonly ServedCopy[] => [...standing.values()].map(servedOf),
    subscribe: (subscriber: (event: CopyEvent) => void): (() => void) => {
      subscribers.add(subscriber);
      for (const copy of [...standing.values()]) subscriber({ kind: 'opened', ...servedOf(copy) });
      return () => {
        subscribers.delete(subscriber);
      };
    },
    generation: (projectId: number): number => projectOf(projectId).generation,
    changing: (projectId: number): boolean => projectOf(projectId).changing !== null,
    current,
    lapsed,
    use,
    hold,
    publish,
    unpublish,
    closed: (copy: Copy): void => tell('closed', copy),
    admitted,
    exclusive,
    letGo,
  };
};

export type Copies = ReturnType<typeof makeCopies>;
