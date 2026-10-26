import { Schema } from 'effect';
import { agentCatalogSchema, agentPreviewInputSchema, agentPreviewSchema } from '../agentLibrary.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { projectField } from '../../../../platform/contract/wire/place.js';

const AGENT_TOOL_READ = {
  approval: ASKS_NEVER,
  doors: { http: true },
  tool: { capability: 'agents' },
  callers: 'any',
  subject: 'none',
  place: 'project',
  graph: 'none',
  waits: [],
  lifetimes: [],
  effect: 'read',
  identity: 'none',
} as const;

export const AGENT_OPERATIONS = {
  read_agent_library: operation('read_agent_library', {
    ...AGENT_TOOL_READ,
    meaning: 'List built-in, project and personal agent definitions, with origins, capabilities and rejected declarations.',
    input: Schema.Struct({ project: projectField }),
    answer: arms({ ok: agentCatalogSchema.fields }),
    refusals: ['not-found', 'unknown-project'],
    subjects: () => [],
    confirmation: () => ({ summary: 'Read the available agent definitions?' }),
    confirmLabel: 'Read definitions',
    presentation: {
      running: 'Reading the agent definitions',
      done: 'Read the agent definitions',
      many: (count) => `Read the agent definitions ${count} times`,
    },
  }),
  read_agent: operation('read_agent', {
    ...AGENT_TOOL_READ,
    meaning: 'Preview an agent definition, its startup prompt and definition-time tool catalog for a new root thread, without starting it.',
    grammar:
      'Use id for a saved definition, or source/sourceFile for a draft. toolCatalog.tools gives names, eager/deferred exposure and the character size of each provider-neutral JSON input schema fixed by the definition; atBirth names sources resolved for the concrete thread, model and connections. The file format: the agent-definitions skill. For an existing thread’s frozen prompt, use read_thread_agent.',
    input: Schema.Struct({
      project: projectField,
      ...agentPreviewInputSchema.fields,
      sourceFile: Schema.optional(
        Schema.String.annotate({
          description:
            'Complete declaration file, absolute or relative to this caller’s proved file scope, read through the caller’s filesystem.',
        }),
      ),
    }),
    answer: arms({ ok: agentPreviewSchema.fields }),
    refusals: ['not-found', 'agent-not-found', 'agent-invalid', 'agent-source', 'unknown-project'],
    subjects: () => [],
    confirmation: (input) => ({
      summary: `Preview agent ${input.id ?? input.sourceFile ?? 'from supplied source'}?`,
    }),
    confirmLabel: 'Preview',
    presentation: {
      running: 'Reading an agent definition',
      done: 'Read an agent definition',
      many: (count) => `Read ${count} agent definitions`,
    },
  }),
};

export type AgentOperationId = keyof typeof AGENT_OPERATIONS;
export const AGENT_OPERATION_IDS = Object.keys(AGENT_OPERATIONS) as readonly AgentOperationId[];
