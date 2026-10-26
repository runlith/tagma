import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { agentSkillAimSchema, agentSkillCatalogSchema } from '../../../../threads/contract/wire/agentLibrary.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

export const SKILL_OPERATIONS = {
  read_agent_skills: operation('read_agent_skills', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    callers: 'operator',
    subject: 'none',
    place: 'home',
    waits: [],
    lifetimes: [],
    meaning:
      'Read the skills a thread, or a draft of the named type, would be offered: each with its description, on the basis the catalog was read from.',
    input: agentSkillAimSchema,
    answer: arms({ read: agentSkillCatalogSchema.fields }),
    refusals: ['unknown-project', 'not-found', 'unknown-type', 'agent-not-found', 'source-unreadable'],
    effect: 'read',
    identity: 'none',
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the offered skills?' }),
    confirmLabel: 'Read skills',
    presentation: { running: 'Reading the offered skills', done: 'Read the offered skills' },
  }),
};

export type SkillOperationId = keyof typeof SKILL_OPERATIONS;
