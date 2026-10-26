import { Context, Effect, Layer } from 'effect';
import { SourceForgetting } from '../../threads/contract/service/engine.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import { rescanPolicy } from '../contract/wire/sourceSettings.js';
import { Settings } from '../../settings/contract/service/values.js';
import { WorkspaceInputs, type WorkspaceInputAim, type WorkspaceInputSet } from '../contract/service/inputs.js';
import { readWorkspaceInputs } from './walk.js';

type Bound = { readonly at: TargetAt; readonly root: string; readonly sources: WorkspaceInputSet };

type Remembered = {
  readonly projectId: number;
  released: number;
  bound: Map<string, Bound>;
};

const keyOf = (at: TargetAt): string => `${at.threadId}\u0000${at.runId}\u0000${at.generation}`;

const walkOf = (projectId: number, root: string): string => `${projectId}\u0000${root}`;

export const workspaceInputsLayer = (
  own: (projectRoot: string) => readonly string[],
): Layer.Layer<WorkspaceInputs | SourceForgetting, never, Settings> =>
  Layer.effectContext(
    Effect.map(
      Effect.gen(function* () {
        const settings = yield* Settings;
        const closed = <A, E>(work: Effect.Effect<A, E, Settings>): Effect.Effect<A, E> => Effect.provideService(work, Settings, settings);
        const remembered = new Map<string, Remembered>();
        const walks = new Map<string, WorkspaceInputSet>();
        let invalidations = 0;
        const entry = (input: WorkspaceInputAim): Remembered => {
          let held = remembered.get(input.threadId);
          if (!held) {
            held = { projectId: input.projectId, released: 0, bound: new Map() };
            remembered.set(input.threadId, held);
          }
          return held;
        };
        const walk = (projectId: number, root: string) => readWorkspaceInputs({ projectId, projectRoot: root, own: own(root) });
        const read = Effect.fn('WorkspaceInputs.read')(function* (input: WorkspaceInputAim) {
          const policy = yield* settings.value(rescanPolicy, input.projectId);
          const key = walkOf(input.projectId, input.root);
          const standing = policy === 'per-turn' ? undefined : walks.get(key);
          if (standing !== undefined) return standing;
          const taken = invalidations;
          const sources = yield* walk(input.projectId, input.root);
          if (policy !== 'per-turn' && invalidations === taken) walks.set(key, sources);
          return sources;
        });
        const newestOf = (held: Remembered | undefined, threadId: string, runId: string): Bound | undefined => {
          if (held === undefined) return undefined;
          let newest: Bound | undefined;
          for (const held_ of held.bound.values()) {
            if (held_.at.threadId !== threadId || held_.at.runId !== runId) continue;
            if (newest === undefined || held_.at.generation > newest.at.generation) newest = held_;
          }
          return newest;
        };
        const forgetWhere = (threadId: string, matches: (bound: Bound) => boolean): void => {
          const held = remembered.get(threadId);
          if (held === undefined) return;
          held.released += 1;
          for (const [key, bound] of [...held.bound]) if (matches(bound)) held.bound.delete(key);
        };
        return {
          preview: (input) => closed(read(input)),
          walk: (projectId, root) => closed(walk(projectId, root)),
          resolve: (input, use, at) =>
            closed(
              Effect.gen(function* () {
                const key = keyOf(at);
                const held = remembered.get(input.threadId);
                if (use.runId !== null) {
                  const standing = held?.bound.get(key);
                  if (standing !== undefined) return standing.sources;
                }
                if (use.kind === 'tools') return yield* read(input);
                const current = held ?? entry(input);
                const released = current.released;
                const sources = yield* read(input);
                if (current.released === released) current.bound.set(key, { at, root: input.root, sources });
                return sources;
              }),
            ),
          snapshot: (threadId, runId) => Effect.sync(() => newestOf(remembered.get(threadId), threadId, runId)?.sources),
          release: (at) =>
            Effect.sync(() => {
              const held = remembered.get(at.threadId);
              if (held === undefined) return;
              const key = keyOf(at);
              held.released += 1;
              held.bound.delete(key);
            }),
          releaseRun: (threadId, runId) =>
            Effect.sync(() => {
              forgetWhere(threadId, (bound) => bound.at.runId === runId);
            }),
          forget: (threadId) =>
            Effect.sync(() => {
              remembered.delete(threadId);
            }),
          invalidate: (input) =>
            Effect.sync(() => {
              invalidations += 1;
              if (input.projectId === undefined) walks.clear();
              else for (const key of [...walks.keys()]) if (key.startsWith(`${input.projectId}\u0000`)) walks.delete(key);
            }),
        } satisfies WorkspaceInputs['Service'];
      }),
      (inputs) =>
        Context.make(WorkspaceInputs, inputs).pipe(Context.add(SourceForgetting, { forget: (threadId) => inputs.forget(threadId) })),
    ),
  );
