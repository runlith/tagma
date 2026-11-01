import type { AgentSkill, AgentSkillPool } from '@runlith/agent/AgentSkill';
import type { SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
import type { SkillScope } from '../contract/wire/sourceSettings.js';
import type { ArtifactStore } from '../../artifacts/contract/service/shelf.js';
import { ARTIFACT_SKILL_ID, artifactSkill, type PublishingContext } from './artifacts.js';
import { showcaseSkill } from './showcase.js';
import { motionSkill } from './motion.js';
import { agentDefinitionsSkill } from './agentDefinitions.js';

export function builtInSkills<TContext extends PublishingContext>(
  artifacts: ArtifactStore['Service'],
  shipped: readonly AgentSkill<unknown>[],
  publishing = true,
): AgentSkillPool<TContext> {
  return [
    artifactSkill<TContext>(artifacts),
    showcaseSkill<TContext>(publishing),
    motionSkill<TContext>(publishing),
    agentDefinitionsSkill<TContext>(),
    ...shipped,
  ];
}

type BuiltIn<TContext> = { readonly skill: AgentSkill<TContext>; readonly enabled: boolean };

const builtInEntries = <TContext extends PublishingContext>(
  artifacts: ArtifactStore['Service'],
  sources: WorkspaceInputSet,
): readonly BuiltIn<TContext>[] =>
  builtInSkills<TContext>(artifacts, sources.shipped, !sources.disabledSkills.has(ARTIFACT_SKILL_ID)).map((skill) => ({
    skill,
    enabled: !sources.disabledSkills.has(skill.id),
  }));

const offeredBeside = (builtIn: readonly BuiltIn<unknown>[], disabled: ReadonlySet<string>) => {
  const held = new Set(builtIn.filter((one) => one.enabled).map((one) => one.skill.id));
  const freed = new Set(builtIn.filter((one) => !one.enabled).map((one) => one.skill.id));
  return {
    held: (name: string): boolean => held.has(name),
    offered: (name: string): boolean => !held.has(name) && (!disabled.has(name) || freed.has(name)),
  };
};

type Placed = { readonly skill: AgentSkill<unknown> | null; readonly entry: SkillInventoryEntry };

const placedMembers = (builtIn: readonly BuiltIn<unknown>[], sources: WorkspaceInputSet): readonly Placed[] => {
  if (sources.members.length === 0) return [];
  const home = new Set([...builtIn.map((one) => one.skill.id), ...sources.inventory.map((entry) => entry.name)]);
  const holders = new Map<string, SkillScope>(builtIn.map((one) => [one.skill.id, 'built-in'] as const));
  for (const entry of sources.inventory) if (!holders.has(entry.name)) holders.set(entry.name, entry.scope);
  const offeredBy = new Map<string, number>();
  for (const member of sources.members) for (const skill of member.skills) offeredBy.set(skill.id, (offeredBy.get(skill.id) ?? 0) + 1);
  return sources.members.flatMap((member) => {
    const offered = new Map(member.skills.map((skill) => [skill.id, skill] as const));
    return member.inventory.map((entry): Placed => {
      const shared = home.has(entry.name) || (offeredBy.get(entry.name) ?? 0) > 1;
      const name = shared ? `${member.project}-${entry.name}` : entry.name;
      const holder = holders.get(name);
      if (holder !== undefined) return { skill: null, entry: { ...entry, name, enabled: false, replacedBy: holder } };
      const skill = entry.enabled ? offered.get(entry.name) : undefined;
      if (skill === undefined) return { skill: null, entry: { ...entry, name } };
      holders.set(name, 'project');
      return { skill: { ...skill, id: name }, entry: { ...entry, name } };
    });
  });
};

export function skillPool<TContext extends PublishingContext>(
  artifacts: ArtifactStore['Service'],
  sources: WorkspaceInputSet,
): AgentSkillPool<TContext> {
  const builtIn = builtInEntries<TContext>(artifacts, sources);
  const names = offeredBeside(builtIn, sources.disabledSkills);
  return [
    ...builtIn.flatMap(({ skill, enabled }) => (enabled ? [skill] : [])),
    ...sources.skills.filter((skill) => names.offered(skill.id)),
    ...placedMembers(builtIn, sources).flatMap(({ skill }) => (skill === null || sources.disabledSkills.has(skill.id) ? [] : [skill])),
  ];
}

export function skillInventory(artifacts: ArtifactStore['Service'], sources: WorkspaceInputSet): readonly SkillInventoryEntry[] {
  const builtIn = builtInEntries(artifacts, sources);
  const names = offeredBeside(builtIn, sources.disabledSkills);
  const discovered = sources.inventory.map((entry): SkillInventoryEntry => ({
    ...entry,
    enabled: entry.enabled && names.offered(entry.name),
    replacedBy: names.held(entry.name) ? 'built-in' : entry.replacedBy,
  }));
  const own = builtIn.map(({ skill, enabled }): SkillInventoryEntry => ({
    name: skill.id,
    description: skill.description,
    path: null,
    directory: null,
    scope: 'built-in',
    plugin: null,
    project: null,
    enabled,
    own: true,
    replacedBy: enabled ? null : (discovered.find((entry) => entry.enabled && entry.name === skill.id)?.scope ?? null),
  }));
  const members = placedMembers(builtIn, sources).map(({ entry }) =>
    entry.enabled && sources.disabledSkills.has(entry.name) ? { ...entry, enabled: false } : entry,
  );
  return [...own, ...discovered, ...members];
}
