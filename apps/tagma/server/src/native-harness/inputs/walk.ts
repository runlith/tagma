import { realpath } from 'node:fs/promises';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import * as path from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { MemberSkills, SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
import { asAgentSkills, discoverSkills, type DiscoveredSkill } from '@runlith/agent-sources/SkillDirectories';
import { readContextFiles } from '@runlith/agent-sources/ContextFiles';
import { Effect, Layer } from 'effect';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { LAW_END, LAW_START } from '../../graph/contract/wire/law.js';
import {
  contextFileNames,
  contextFilesEnabled,
  skillGlobalDirectories,
  skillProjectDirectories,
  globalSkillsEnabled,
  ownSkillEnabled,
  projectSkillsEnabled,
  skillsDisabled,
} from '../contract/wire/sourceSettings.js';
import { Settings } from '../../settings/contract/service/values.js';
import { withBridgeMethods } from '../skills/bridgeMethods.js';
import { SHIPPED_SKILLS } from '../skills/shipped.js';
import type { BridgeMethod } from '../../views/contract/wire/bridge.js';
import type { PluginLoaded } from '../../plugins/contract/service/plugins.js';
import { readPluginSkills } from './plugins.js';

export const readWorkspaceInputs = Effect.fn('workspaceInputs.read')(function* (input: {
  projectId: number;
  projectRoot: string;
  own: readonly string[];
  plugins: readonly PluginLoaded[];
  bridge: readonly BridgeMethod[];
  cwd?: string;
}): Effect.fn.Return<WorkspaceInputSet, StoreFailure | GateRefusal<'source-unreadable'>, Settings> {
  const settings = yield* Settings;
  const plugins = yield* readPluginSkills(input.plugins);
  const configured = yield* settings.chain(input.projectId);
  const readFiles = configured(contextFilesEnabled);
  const names = configured(contextFileNames);
  const projectSkills = configured(projectSkillsEnabled);
  const globalSkills = configured(globalSkillsEnabled);
  const globals = globalSkills ? configured(skillGlobalDirectories) : [];
  const projectDirectories = projectSkills ? configured(skillProjectDirectories) : [];
  const disabled = yield* settings.held(skillsDisabled, input.projectId);
  let hidden = disabled();
  let mask = new Set(hidden);
  const offerOwn = configured(ownSkillEnabled);

  const contextFiles = readFiles
    ? yield* readContextFiles({
        cwd: input.cwd ?? input.projectRoot,
        root: input.projectRoot,
        names,
        strip: stripManagedLaw,
      }).pipe(
        Effect.provide(BunFileSystem.layer),
        Effect.mapError(
          (failure) =>
            new GateRefusal(
              'source-unreadable',
              `${failure.path}: ${failure.cause instanceof Error ? failure.cause.message : String(failure.cause)}`,
              ['Check the instruction file and its permissions, then start the turn again.'],
            ),
        ),
      )
    : [];

  const globalDirectories = globals.map(expandHome);
  const directories = [...globalDirectories, ...projectDirectories.map((dir) => path.resolve(input.projectRoot, dir))];
  const discovered =
    directories.length > 0
      ? yield* discoverSkills({ directories }).pipe(Effect.provide(BunFileSystem.layer))
      : { skills: [], rejected: [] };
  const shipped = yield* discoverSkills({ directories: [SHIPPED_SKILLS] }).pipe(Effect.provide(BunFileSystem.layer));
  const rejected = [...shipped.rejected, ...discovered.rejected];
  yield* refuseUnreadable(rejected);

  const globalSet = new Set(globalDirectories);
  const ownPaths = yield* ownPathsOf(discovered.skills, input.own);
  const isOwn = (skillPath: string): boolean => ownPaths.has(skillPath);
  const offered = (skillPath: string): boolean => offerOwn || !isOwn(skillPath);
  const found = discovered.skills.map((skill): SkillInventoryEntry => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    directory: skill.directory,
    scope: globalSet.has(skill.directory) ? 'global' : 'project',
    plugin: null,
    project: null,
    enabled: offered(skill.path),
    own: isOwn(skill.path),
    replacedBy: null,
  }));
  const standing = new Map(found.filter((entry) => entry.enabled).map((entry) => [entry.name, entry.scope]));
  const inventory = [
    ...plugins.inventory.map((entry) => {
      const replacedBy = standing.get(entry.name) ?? null;
      return replacedBy === null ? entry : { ...entry, enabled: false, replacedBy };
    }),
    ...found,
  ];

  return {
    contextFiles,
    shipped: withBridgeMethods(asAgentSkills<unknown>(shipped.skills), input.bridge),
    skills: [
      ...plugins.skills.filter((skill) => !standing.has(skill.id)),
      ...asAgentSkills<unknown>(discovered.skills.filter((skill) => offered(skill.path))),
    ],
    members: [],
    get disabledSkills() {
      const current = disabled();
      if (current !== hidden) {
        hidden = current;
        mask = new Set(current);
      }
      return mask;
    },
    inventory,
    rejected: [...rejected, ...plugins.rejected],
  };
});

export const readMemberSkills = Effect.fn('workspaceInputs.member')(function* (member: {
  readonly projectId: number;
  readonly name: string;
  readonly root: string;
  readonly own: readonly string[];
}): Effect.fn.Return<MemberSkills, StoreFailure | GateRefusal<'source-unreadable'>, Settings> {
  const configured = yield* (yield* Settings).chain(member.projectId);
  const directories = configured(skillProjectDirectories).map((dir) => path.resolve(member.root, dir));
  const discovered = yield* discoverSkills({ directories }).pipe(Effect.provide(BunFileSystem.layer));
  yield* refuseUnreadable(discovered.rejected);
  const ownPaths = yield* ownPathsOf(discovered.skills, member.own);
  return {
    project: member.name,
    skills: asAgentSkills<unknown>(discovered.skills).map((skill) => ({ ...skill, place: member.name })),
    inventory: discovered.skills.map((skill): SkillInventoryEntry => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      directory: skill.directory,
      scope: 'project',
      plugin: null,
      project: member.name,
      enabled: true,
      own: ownPaths.has(skill.path),
      replacedBy: null,
    })),
    rejected: discovered.rejected,
  };
});

export function withMembers(home: WorkspaceInputSet, members: readonly MemberSkills[], offerOwn: boolean): WorkspaceInputSet {
  if (members.length === 0) return home;
  const offered = members.map((member): MemberSkills => {
    if (offerOwn) return member;
    const own = new Set(member.inventory.flatMap((entry) => (entry.own ? [entry.name] : [])));
    return {
      ...member,
      skills: member.skills.filter((skill) => !own.has(skill.id)),
      inventory: member.inventory.map((entry) => (entry.own ? { ...entry, enabled: false } : entry)),
    };
  });
  return {
    contextFiles: home.contextFiles,
    shipped: home.shipped,
    skills: home.skills,
    members: offered,
    get disabledSkills() {
      return home.disabledSkills;
    },
    inventory: home.inventory,
    rejected: [...home.rejected, ...members.flatMap((member) => member.rejected)],
  };
}

const refuseUnreadable = Effect.fnUntraced(function* (rejected: readonly { readonly path: string; readonly reason: string }[]) {
  const unreadable = rejected.find((entry) => entry.reason === 'unreadable');
  if (unreadable === undefined) return;
  return yield* new GateRefusal('source-unreadable', `${unreadable.path}: it cannot be listed or read`, [
    'Check the source directory and its permissions, then read the skill catalog again.',
  ]);
});

const ownPathsOf = Effect.fnUntraced(function* (skills: readonly DiscoveredSkill[], own: readonly string[]) {
  const targets = new Set(yield* Effect.forEach(own, realOrSelf, { concurrency: 'unbounded' }));
  const identities = yield* Effect.forEach(
    skills,
    (skill) => realOrSelf(path.dirname(skill.path)).pipe(Effect.map((directory) => ({ path: skill.path, own: targets.has(directory) }))),
    { concurrency: 'unbounded' },
  );
  return new Set(identities.flatMap((identity) => (identity.own ? [identity.path] : [])));
});

export function stripManagedLaw(body: string): string {
  const start = body.indexOf(LAW_START);
  const end = body.indexOf(LAW_END);
  if (start === -1 || end === -1 || end < start) return body;
  return `${body.slice(0, start)}${body.slice(end + LAW_END.length)}`;
}

function expandHome(directory: string): string {
  if (!directory.startsWith('~')) return directory;
  const home = process.env.HOME;
  return home ? path.join(home, directory.slice(1)) : directory;
}

function realOrSelf(target: string): Effect.Effect<string, GateRefusal<'source-unreadable'>> {
  return Effect.tryPromise({
    try: () => realpath(target),
    catch: (cause) => ({ _tag: 'SourcePathResolution' as const, cause }),
  }).pipe(
    Effect.catch(({ cause }) => {
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
      if (code === 'ENOENT' || code === 'ENOTDIR') return Effect.succeed(target);
      return Effect.fail(
        new GateRefusal('source-unreadable', `${target}: ${cause instanceof Error ? cause.message : String(cause)}`, [
          'Check the source directory and its permissions, then read the skill catalog again.',
        ]),
      );
    }),
  );
}
