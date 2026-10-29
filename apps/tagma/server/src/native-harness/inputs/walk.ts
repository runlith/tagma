import { realpath } from 'node:fs/promises';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import * as path from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
import { asAgentSkills, discoverSkills } from '@runlith/agent-sources/SkillDirectories';
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
import { SHIPPED_SKILLS } from '../skills/shipped.js';
import type { PluginLoaded } from '../../plugins/contract/service/plugins.js';
import { readPluginSkills } from './plugins.js';

export const readWorkspaceInputs = Effect.fn('workspaceInputs.read')(function* (input: {
  projectId: number;
  projectRoot: string;
  own: readonly string[];
  plugins: readonly PluginLoaded[];
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

  const unreadable = rejected.find((entry) => entry.reason === 'unreadable');
  if (unreadable !== undefined) {
    return yield* new GateRefusal('source-unreadable', `${unreadable.path}: it cannot be listed or read`, [
      'Check the source directory and its permissions, then read the skill catalog again.',
    ]);
  }

  const globalSet = new Set(globalDirectories);
  const ownTargets = new Set(yield* Effect.forEach(input.own, realOrSelf, { concurrency: 'unbounded' }));
  const identities = yield* Effect.forEach(
    discovered.skills,
    (skill) => realOrSelf(path.dirname(skill.path)).pipe(Effect.map((directory) => ({ path: skill.path, own: ownTargets.has(directory) }))),
    { concurrency: 'unbounded' },
  );
  const ownPaths = new Set(identities.filter((identity) => identity.own).map((identity) => identity.path));
  const isOwn = (skillPath: string): boolean => ownPaths.has(skillPath);
  const offered = (skillPath: string): boolean => offerOwn || !isOwn(skillPath);
  const found = discovered.skills.map((skill): SkillInventoryEntry => ({
    name: skill.name,
    description: skill.description,
    path: skill.path,
    directory: skill.directory,
    scope: globalSet.has(skill.directory) ? 'global' : 'project',
    plugin: null,
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
    shipped: asAgentSkills<unknown>(shipped.skills),
    skills: [
      ...plugins.skills.filter((skill) => !standing.has(skill.id)),
      ...asAgentSkills<unknown>(discovered.skills.filter((skill) => offered(skill.path))),
    ],
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
