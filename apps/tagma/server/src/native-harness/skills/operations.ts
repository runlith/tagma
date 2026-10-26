import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { AgentSkills } from '../contract/service/agents.js';
import { SKILL_OPERATIONS as OPS, type SkillOperationId } from '../contract/wire/operations/skills.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';

export const SKILL_PAIRS: { readonly [K in SkillOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_agent_skills: pair(
    OPS.read_agent_skills,
    body(OPS.read_agent_skills, {
      execute: (input) =>
        declaredRefusals(OPS.read_agent_skills)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const catalog = yield* (yield* AgentSkills).list(call.project.id, input);
            return { status: 'read' as const, ...catalog };
          }),
        ),
    }),
  ),
};
