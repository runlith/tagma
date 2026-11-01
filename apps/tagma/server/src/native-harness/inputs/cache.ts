import { Context, Effect, Layer } from 'effect';
import { EnabledPlugins, type PluginLoaded } from '../../plugins/contract/service/plugins.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { SourceForgetting } from '../../threads/contract/service/engine.js';
import type { TargetAt } from '../../workspace/contract/wire/place.js';
import { ownSkillEnabled, projectSkillsEnabled, rescanPolicy } from '../contract/wire/sourceSettings.js';
import { Settings } from '../../settings/contract/service/values.js';
import { ProjectGroups } from '../../projects/contract/service/registry.js';
import type { ProjectRow } from '../../projects/contract/wire/project.js';
import { WorkspaceInputs, type MemberSkills, type WorkspaceInputAim, type WorkspaceInputSet } from '../contract/service/inputs.js';
import type { BridgeMethod } from '../../views/contract/wire/bridge.js';
import { readMemberSkills, readWorkspaceInputs, withMembers } from './walk.js';

type Bound = { readonly at: TargetAt; readonly root: string; readonly sources: WorkspaceInputSet };

type Remembered = {
  readonly projectId: number;
  released: number;
  bound: Map<string, Bound>;
};

const keyOf = (at: TargetAt): string => `${at.threadId}\u0000${at.runId}\u0000${at.generation}`;

const walkOf = (projectId: number, root: string): string => `${projectId}\u0000${root}`;

type Walked = { readonly plugins: string; readonly sources: WorkspaceInputSet };

const signatureOf = (enabled: readonly PluginLoaded[]): string => JSON.stringify(enabled.map((plugin) => [plugin.id, plugin.revision]));

export const workspaceInputsLayer = (
  own: (projectRoot: string) => readonly string[],
  bridge: readonly BridgeMethod[],
): Layer.Layer<WorkspaceInputs | SourceForgetting, never, Settings | EnabledPlugins | ProjectGroups> =>
  Layer.effectContext(
    Effect.map(
      Effect.gen(function* () {
        const settings = yield* Settings;
        const plugins = yield* EnabledPlugins;
        const groups = yield* ProjectGroups;
        const closed = <A, E>(work: Effect.Effect<A, E, Settings>): Effect.Effect<A, E> => Effect.provideService(work, Settings, settings);
        const remembered = new Map<string, Remembered>();
        const walks = new Map<string, Walked>();
        const memberWalks = new Map<string, MemberSkills>();
        let invalidations = 0;
        const entry = (input: WorkspaceInputAim): Remembered => {
          let held = remembered.get(input.threadId);
          if (!held) {
            held = { projectId: input.projectId, released: 0, bound: new Map() };
            remembered.set(input.threadId, held);
          }
          return held;
        };
        const enabledIn = (projectId: number) =>
          plugins
            .of(projectId)
            .pipe(
              Effect.mapError(
                (failure) =>
                  new GateRefusal('source-unreadable', `the plugins enabled here: ${failure.reason}`, [
                    'Read the plugins with read_plugins, fix or disable the one named, then read the skill catalog again.',
                  ]),
              ),
            );
        const walkWith = (projectId: number, root: string, enabled: readonly PluginLoaded[]) =>
          readWorkspaceInputs({ projectId, projectRoot: root, own: own(root), plugins: enabled, bridge });
        const memberOf = (member: ProjectRow, remembered: boolean) => {
          const key = walkOf(member.id, member.rootPath);
          const standing = remembered ? memberWalks.get(key) : undefined;
          if (standing !== undefined) return Effect.succeed(standing);
          const taken = invalidations;
          return Effect.tap(
            readMemberSkills({ projectId: member.id, name: member.name, root: member.rootPath, own: own(member.rootPath) }),
            (walked) =>
              Effect.sync(() => {
                if (remembered && invalidations === taken) memberWalks.set(key, walked);
              }),
          );
        };
        const grouped = Effect.fn('WorkspaceInputs.members')(function* (projectId: number, home: WorkspaceInputSet, remembered: boolean) {
          if (!(yield* settings.value(projectSkillsEnabled, projectId))) return home;
          const group = yield* groups.of(projectId);
          if (group === undefined || group.graph.id === projectId) return home;
          const members = yield* Effect.forEach(
            group.members.filter((member) => member.id !== projectId),
            (member) => memberOf(member, remembered),
            { concurrency: 'unbounded' },
          );
          return withMembers(home, members, yield* settings.value(ownSkillEnabled, projectId));
        });
        const walk = (projectId: number, root: string) =>
          enabledIn(projectId).pipe(
            Effect.flatMap((enabled) => walkWith(projectId, root, enabled)),
            Effect.flatMap((home) => grouped(projectId, home, false)),
          );
        const homeOf = Effect.fnUntraced(function* (input: WorkspaceInputAim, remembered: boolean) {
          const enabled = yield* enabledIn(input.projectId);
          const key = walkOf(input.projectId, input.root);
          const signature = signatureOf(enabled);
          const standing = remembered ? walks.get(key) : undefined;
          if (standing !== undefined && standing.plugins === signature) return standing.sources;
          const taken = invalidations;
          const sources = yield* walkWith(input.projectId, input.root, enabled);
          if (remembered && invalidations === taken) walks.set(key, { plugins: signature, sources });
          return sources;
        });
        const read = Effect.fn('WorkspaceInputs.read')(function* (input: WorkspaceInputAim) {
          const remembered = (yield* settings.value(rescanPolicy, input.projectId)) !== 'per-turn';
          return yield* grouped(input.projectId, yield* homeOf(input, remembered), remembered);
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
              for (const remembered of [walks, memberWalks]) {
                if (input.projectId === undefined) remembered.clear();
                else for (const key of [...remembered.keys()]) if (key.startsWith(`${input.projectId}\u0000`)) remembered.delete(key);
              }
            }),
        } satisfies WorkspaceInputs['Service'];
      }),
      (inputs) =>
        Context.make(WorkspaceInputs, inputs).pipe(Context.add(SourceForgetting, { forget: (threadId) => inputs.forget(threadId) })),
    ),
  );
