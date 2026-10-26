import { Schema } from 'effect';
import { agentDefinitionSchema, agentPreviewSchema, agentSaveSchema } from '../../../../threads/contract/wire/agentLibrary.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { projectField } from '../../../../platform/contract/wire/place.js';

export const NATIVE_AGENT_OPERATIONS = {
  read_thread_agent: operation('read_thread_agent', {
    approval: ASKS_NEVER,
    doors: { http: 'perform' },
    tool: { capability: 'agents' },
    callers: 'any',
    subject: 'head',
    waits: [],
    lifetimes: [],
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: agentPreviewSchema.fields }),
    meaning:
      'Read a thread’s exact frozen system prompt and saved definition profile, not a recomposition from current files. Reports missing historical provenance.',
    place: 'project',
    input: Schema.Struct({ threadId: ThreadId }),
    refusals: ['not-found', 'foreign-project', 'unknown-project'],
    subjects: () => [],
    confirmation: (input) => ({ summary: `Read the frozen agent prompt of ${input.threadId}?` }),
    confirmLabel: 'Read prompt',
    presentation: {
      running: 'Reading a frozen agent prompt',
      done: 'Read a frozen agent prompt',
      many: (count) => `Read ${count} frozen agent prompts`,
    },
  }),
  save_agent: operation('save_agent', {
    approval: ASKS_IN_REVIEW,
    doors: { http: 'perform' },
    tool: { capability: 'agents' },
    callers: 'any',
    subject: 'none',
    place: 'project',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'call' },
    answer: arms({ ok: agentDefinitionSchema.fields }),
    meaning:
      'Create or replace a Markdown agent declaration in the project or personal library. Existing threads adopt it through refresh_thread_instructions.',
    grammar:
      'Provide the complete declaration as source or sourceFile, not both. sourceFile is read through the caller’s world, absolute or relative to its proved file scope; a relative path with no scope refuses. The destination is the server’s library, not a guest checkout. Use revision null to create, or the last-read revision to replace; stale revisions refuse. Frontmatter: description, extends, capabilities, tools, model, sections (edits addressed by read_agent’s prompt.sections ids); the body follows. The full format and who is offered the saved type: the agent-definitions skill.',
    input: Schema.Struct({
      project: projectField,
      ...agentSaveSchema.fields,
      source: Schema.optional(Schema.String),
      sourceFile: Schema.optional(Schema.String),
    }),
    refusals: [
      'not-found',
      'agent-name',
      'agent-invalid',
      'agent-source',
      'agent-changed',
      'agent-path',
      'agent-file-io',
      'unknown-project',
    ],
    subjects: (_input, destination: string | undefined) =>
      destination === undefined ? [] : [{ kind: 'write' as const, value: destination, file: true as const }],
    confirmation: (input) => ({
      summary: `${input.revision === null ? 'Create' : 'Replace'} ${input.name} in the ${input.scope} agent library?`,
    }),
    confirmLabel: 'Save definition',
    presentation: {
      running: 'Saving an agent definition',
      done: 'Saved an agent definition',
    },
  }),
};

export type NativeAgentOperationId = keyof typeof NATIVE_AGENT_OPERATIONS;
export const NATIVE_AGENT_OPERATION_IDS = Object.keys(NATIVE_AGENT_OPERATIONS) as readonly NativeAgentOperationId[];
