import { dirname } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { type AgentSkill, AgentSkillUnreadable } from '@runlith/agent/AgentSkill';
import { asAgentSkills, readSkillFolders } from '@runlith/agent-sources/SkillDirectories';
import { Effect } from 'effect';
import type { PluginLoaded } from '../../plugins/contract/service/plugins.js';
import type { SkillInventoryEntry } from '../contract/service/inputs.js';

export type PluginSkills = {
  readonly skills: readonly AgentSkill<unknown>[];
  readonly inventory: readonly SkillInventoryEntry[];
  readonly rejected: readonly { readonly path: string; readonly reason: string }[];
};

export const readPluginSkills = Effect.fn('workspaceInputs.plugins')(function* (plugins: readonly PluginLoaded[]) {
  const skills: AgentSkill<unknown>[] = [];
  const inventory: SkillInventoryEntry[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const plugin of plugins) {
    const read = yield* readSkillFolders(
      plugin.skills.map((skill) => ({ name: skill.name, location: skill.directory, directory: dirname(skill.directory) })),
    ).pipe(Effect.provide(BunFileSystem.layer));
    rejected.push(...read.rejected);
    skills.push(...asAgentSkills<unknown>(read.skills));
    for (const skill of read.skills) {
      inventory.push({ ...entry(plugin, skill.name, skill.description), path: skill.path, directory: skill.directory });
    }
    for (const command of plugin.commands) {
      skills.push({
        id: command.name,
        description: command.description,
        arguments: true,
        instructions: () => Effect.mapError(command.body, (failure) => new AgentSkillUnreadable({ reason: failure.message })),
      });
      inventory.push(entry(plugin, command.name, command.description));
    }
  }
  return { skills, inventory, rejected } satisfies PluginSkills;
});

const entry = (plugin: PluginLoaded, name: string, description: string): SkillInventoryEntry => ({
  name,
  description,
  path: null,
  directory: null,
  scope: 'plugin',
  plugin: plugin.id,
  enabled: true,
  own: false,
  replacedBy: null,
});
