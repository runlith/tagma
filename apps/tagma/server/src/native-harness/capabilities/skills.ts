import { agentSkillRule, agentSkillTools } from '@runlith/agent/AgentSkill';
import { LOAD_SKILL_TOOL } from '@runlith/agent/skillWords';
import { agentRule } from '@runlith/agent/AgentRuntimePolicy';
import { skillPool } from '../skills/pool.js';
import { skillCatalogSection } from '../turns/worldState.js';
import type { ThreadContext } from '../turns/context.js';
import type { CapabilityBehaviour } from './contract.js';
import { agentSkillRequestRule } from '@runlith/agent/agentSkillRequests';
import { canLoadSkills } from '../agents/effectiveAgent.js';
import type { NativeRuleSource } from '../contract/service/rules.js';

const EXPLICIT_RULE = 'explicit-skills';
export const explicitSkillSource: NativeRuleSource = {
  id: EXPLICIT_RULE,
  create: ({ declaration, definitions }) =>
    agentRule<ThreadContext>(
      EXPLICIT_RULE,
      (ctx) =>
        agentSkillRequestRule<ThreadContext, string>(
          canLoadSkills(definitions.effective(declaration, ctx.thread.profile?.overlay), ctx.thread.profile?.overlay)
            ? skillPool<ThreadContext>(ctx.artifacts, ctx.sources)
            : [],
        )(ctx),
      { owner: 'skills', hook: 'beforeStep', priority: -40, critical: true },
    ),
};

export const skills: CapabilityBehaviour = {
  catalog: {
    revision: (ctx) => JSON.stringify([...ctx.sources.disabledSkills]),
    notice: (ctx) =>
      `Available skills: ${
        skillPool<ThreadContext>(ctx.artifacts, ctx.sources)
          .map((skill) => skill.id)
          .join(', ') || 'none'
      }. This replaces the previous list of available skill ids.`,
  },
  source: {
    id: 'skills',
    names: [LOAD_SKILL_TOOL],
    tools: (ctx) => agentSkillTools(skillPool<ThreadContext>(ctx.artifacts, ctx.sources), ctx),
  },
  rules: [
    agentRule<ThreadContext>(
      'skills',
      (ctx) => agentSkillRule<ThreadContext, string>(skillPool<ThreadContext>(ctx.artifacts, ctx.sources))(ctx),
      { owner: 'skills', critical: true },
    ),
  ],
  turnNote: (ctx) => [
    skillCatalogSection(
      skillPool<ThreadContext>(ctx.artifacts, ctx.sources).map((skill) => ({
        id: skill.id,
        description: skill.description,
        place: skill.place,
        references: skill.references?.map(({ name, description }) => ({ name, description })),
      })),
    ),
  ],
};
