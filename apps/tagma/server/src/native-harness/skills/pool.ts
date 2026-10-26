import type { AgentSkill, AgentSkillPool } from '@runlith/agent/AgentSkill';
import type { SkillInventoryEntry, WorkspaceInputSet } from '../contract/service/inputs.js';
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

export function skillPool<TContext extends PublishingContext>(
  artifacts: ArtifactStore['Service'],
  sources: WorkspaceInputSet,
): AgentSkillPool<TContext> {
  const builtIn = builtInEntries<TContext>(artifacts, sources);
  const names = offeredBeside(builtIn, sources.disabledSkills);
  return [
    ...builtIn.flatMap(({ skill, enabled }) => (enabled ? [skill] : [])),
    ...sources.skills.filter((skill) => names.offered(skill.id)),
  ];
}

export function skillInventory(artifacts: ArtifactStore['Service'], sources: WorkspaceInputSet): readonly SkillInventoryEntry[] {
  const builtIn = builtInEntries(artifacts, sources);
  const names = offeredBeside(builtIn, sources.disabledSkills);
  const discovered = sources.inventory.map((entry): SkillInventoryEntry => ({
    ...entry,
    enabled: entry.enabled && names.offered(entry.name),
    replacedBy: names.held(entry.name) ? 'built-in' : null,
  }));
  const own = builtIn.map(({ skill, enabled }): SkillInventoryEntry => ({
    name: skill.id,
    description: skill.description,
    path: null,
    directory: null,
    scope: 'built-in',
    enabled,
    own: true,
    replacedBy: enabled ? null : (discovered.find((entry) => entry.enabled && entry.name === skill.id)?.scope ?? null),
  }));
  return [...own, ...discovered];
}
