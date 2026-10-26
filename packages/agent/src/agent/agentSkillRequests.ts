import { Effect } from 'effect';
import { skillReference } from './skillReferences';
import { agentInputSkills } from './AgentSignal';
import { type AgentSkill, loadedAgentSkillIds } from './AgentSkill';
import { LOAD_SKILL_TOOL } from './skillWords';
import { type AgentRule, agentRule } from './policy/AgentRuntimePolicy';

export function agentSkillRequestRule<TCtx, TId extends string>(skills: readonly AgentSkill<TCtx, TId>[]): AgentRule<TCtx> {
  const available = new Set<string>(skills.map((skill) => skill.id));
  return agentRule<TCtx>(
    'explicit-skills',
    (ctx) => {
      if (ctx.hook !== 'beforeStep') return null;
      let input: ReadonlySet<string> | null = null;
      for (let index = ctx.modelMessages.length - 1; index >= 0; index -= 1) {
        input = agentInputSkills(ctx.modelMessages[index]!);
        if (input !== null) break;
      }
      if (input === null) return null;
      const requested = [...input].filter((id) => available.has(id));
      if (requested.length === 0) return null;
      const asked = skills.filter((skill) => requested.includes(skill.id));
      return Effect.gen(function* () {
        const loaded: ReadonlySet<string> = yield* loadedAgentSkillIds(asked, ctx, ctx.modelMessages);
        const pending = requested.filter((id) => !loaded.has(id));
        return pending.length > 0
          ? {
              type: 'request' as const,
              tool: LOAD_SKILL_TOOL,
              text: `Call load_skill for the reader-requested skills before other work: ${pending.map(skillReference).join(', ')}.`,
            }
          : null;
      });
    },
    { owner: 'skills', critical: true },
  );
}
