import { Schema } from 'effect';
import { type Raised } from '@runlith/agent/permissions';
import type { SpawnWorktrees } from '@runlith/agent/collaboration/CollaborationConfig';
import {
  ANSWER_APPROVAL,
  COMPACT_OUTCOMES,
  CONTINUE_AGENT,
  INTERRUPT_AGENT,
  LIST_AGENTS,
  SEND_MESSAGE,
  SEND_TASK,
  SPAWN_AGENT,
  STOP_AGENT,
  answerApprovalInput,
  childInput,
  compactingTaskInput,
  interruptAgentInput,
  interruptQuestion,
  listAgentsInput,
  messageQuestion,
  sendMessageInput,
  spawnAgentInput,
  plainRaised,
  taskQuestion,
  worktreeRaised,
} from '@runlith/agent/collaboration/collaborationVerbs';
import {
  APPROVAL_REFUSALS,
  CHILD_REFUSALS,
  INTERRUPT_REFUSALS,
  SEND_REFUSALS,
  SPAWN_REFUSALS,
  TASK_REFUSALS,
} from '@runlith/agent/collaboration/refusals';
import { COLLABORATION_WORDS } from '@runlith/agent/collaboration/words';
import { spawnTypeSubject, threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { THREAD_SUMMARIZER_REASONS, THREAD_SUMMARIZER_SKIP_REASONS } from '@runlith/agent/transcript/entries';
import { signerPrincipal, type Actor } from '../../../../platform/contract/wire/actor.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';
import { NEW_WORKTREE, NOT_A_CHILD, NOT_A_DESCENDANT, PLAIN_CHILD } from '@runlith/agent/collaboration/collaborationVerbs';
import { OWN_LINEAGE } from '../../../../platform/contract/wire/conditions.js';
import { placeRole } from '../../../../platform/contract/wire/place.js';

const verb = {
  doors: { http: true },
  tool: { capability: 'peers', runtime: true },
  callers: 'thread',
  subject: 'none',
  place: 'machine',
  graph: 'none',
  waits: [],
  lifetimes: [],
} as const;

const act = { ...verb, approval: ASKS_IN_REVIEW, effect: 'write', identity: { key: 'call' } } as const;

const agent = (kind: 'read' | 'write', address: string, actor: Actor) =>
  actor.kind === 'operator' ? [] : [{ kind, value: threadAgentSubject(signerPrincipal(actor), address) }];

const target = { threadId: Schema.String, projectId: Schema.optional(Schema.Int) };

const addressedChild = Schema.Struct({ threadId: childInput.fields.threadId.annotate(placeRole('value')) });

const answeringApproval = Schema.Struct({
  ...answerApprovalInput.fields,
  threadId: answerApprovalInput.fields.threadId.annotate(placeRole('value')),
});

const approvalChosen = {
  ...target,
  questionId: Schema.String,
  allow: Schema.optional(Schema.Boolean),
  value: Schema.optional(Schema.String),
  values: Schema.optional(Schema.Array(Schema.String)),
  answers: Schema.optional(Schema.Array(Schema.Struct({ questionId: Schema.String, values: Schema.Array(Schema.String) }))),
};

const spawning = Schema.Struct({
  ...spawnAgentInput.fields,
  project: spawnAgentInput.fields.project.annotate(placeRole('selector')),
  worktree: spawnAgentInput.fields.worktree.annotate(placeRole('value')),
});

const Delivery = Schema.Struct({
  envelopeId: Schema.String,
  intent: Schema.Literals(['message', 'task', 'report', 'interrupt', 'approval']),
  status: Schema.Literals(['delivered', 'queued', 'woken', 'stored', 'pending']),
  runId: Schema.NullOr(Schema.String),
  acted: Schema.Boolean,
  recipient: Schema.Struct({ ...target, name: Schema.NullOr(Schema.String), sameTeam: Schema.Boolean }),
  failure: Schema.optional(Schema.String),
  closed: Schema.optional(Schema.Array(Schema.String)),
  acceptance: Schema.optional(
    Schema.Union([
      Schema.Struct({ status: Schema.Literal('confirmed') }),
      Schema.Struct({ status: Schema.Literal('unconfirmed'), reason: Schema.String }),
    ]),
  ),
  compaction: Schema.optional(
    Schema.Struct({
      requestId: Schema.String,
      runId: Schema.NullOr(Schema.String),
      summarizer: Schema.NullOr(
        Schema.Struct({
          provider: Schema.String,
          model: Schema.NullOr(Schema.String),
          reasoning: Schema.NullOr(Schema.String),
          account: Schema.NullOr(Schema.String),
          own: Schema.Boolean,
          reason: Schema.Literals(THREAD_SUMMARIZER_REASONS),
        }),
      ),
    }),
  ),
  cache: Schema.optional(Schema.String),
});

const sent = arms({
  sent: { deliveries: Schema.Array(Delivery) },
  refused: {
    code: Schema.Literals(['no-open-request', 'final-in-reply', 'final-to-many', 'compact-to-many', 'no-summarizer', 'cold-wake']),
    cold: Schema.optional(
      Schema.Array(Schema.Struct({ threadId: Schema.String, name: Schema.NullOr(Schema.String), tokens: Schema.Number })),
    ),
    reason: Schema.String,
    unblock: Schema.Array(Schema.String),
    skipped: Schema.optional(
      Schema.Array(
        Schema.Struct({
          provider: Schema.String,
          model: Schema.String,
          reason: Schema.Literals(THREAD_SUMMARIZER_SKIP_REASONS),
          until: Schema.optional(Schema.String),
        }),
      ),
    ),
  },
  'not-found': {
    addresses: Schema.Array(Schema.String),
    addressable: Schema.Array(Schema.String),
    reason: Schema.String,
    unblock: Schema.Array(Schema.String),
  },
});

const unsent = ['refused', 'not-found'] as const;

const writesTo = (to: readonly string[], actor: Actor) => to.flatMap((address) => agent('write', address, actor));

const PLACEMENT_REFUSALS = [
  'worktrees-ask',
  'worktree-unknown',
  'worktree-unavailable',
  'guest-mobility',
  'placement-refused',
  'unknown-project',
  'ambiguous-project',
  'global-missing',
  'no-home',
] as const;

export type SpawnPrepared = { readonly asking: SpawnWorktrees | null; readonly home?: number };

export const COLLABORATION_OPERATIONS = {
  list_agents: operation('list_agents', {
    approval: ASKS_NEVER,
    ...verb,
    effect: 'read',
    identity: 'none',
    meaning: LIST_AGENTS,
    input: listAgentsInput,
    answer: arms({ listed: { page: Schema.String, total: Schema.Int, cursor: Schema.NullOr(Schema.String) } }),
    refusals: ['no-calling-thread', 'bad-cursor', 'cursor-stale', 'collaboration-refused'],
    subjects: (_input, _prepared, actor) => agent('read', '*', actor),
    confirmation: () => ({ summary: 'Read the agents of this server?' }),
    confirmLabel: 'Read',
    presentation: COLLABORATION_WORDS.list_agents,
  }),
  send_message: operation('send_message', {
    ...act,
    meaning: SEND_MESSAGE,
    input: sendMessageInput,
    answer: sent,
    negative: unsent,
    refusals: ['no-calling-thread', ...SEND_REFUSALS, 'collaboration-refused'],
    subjects: (input, _prepared, actor) => writesTo(input.to, actor),
    confirmation: messageQuestion,
    confirmLabel: 'Send',
    presentation: COLLABORATION_WORDS.send_message,
  }),
  send_task: operation('send_task', {
    ...act,
    approval: { ...ASKS_IN_REVIEW, when: [NOT_A_DESCENDANT] },
    meaning: SEND_TASK + COMPACT_OUTCOMES,
    input: compactingTaskInput,
    answer: sent,
    negative: unsent,
    refusals: ['no-calling-thread', ...TASK_REFUSALS, 'collaboration-refused'],
    subjects: (input, crossing: readonly Raised[] | undefined, actor) => writesTo(input.to, actor),
    raises: (input, crossing: readonly Raised[] | undefined, actor) => crossing ?? [],
    confirmation: taskQuestion,
    confirmLabel: 'Send',
    presentation: COLLABORATION_WORDS.send_task,
  }),
  answer_approval: operation('answer_approval', {
    ...verb,
    approval: ASKS_NEVER,
    effect: 'write',
    identity: { key: 'call' },
    meaning: ANSWER_APPROVAL,
    input: answeringApproval,
    answer: arms({ answered: approvalChosen }),
    refusals: ['no-calling-thread', ...APPROVAL_REFUSALS, 'collaboration-refused'],
    subjects: (input, _prepared, actor) => agent('write', input.threadId, actor),
    confirmation: (input) => ({ summary: `Answer ${input.threadId}'s question?` }),
    confirmLabel: 'Answer',
    presentation: COLLABORATION_WORDS.answer_approval,
  }),
  interrupt_agent: operation('interrupt_agent', {
    ...act,
    approval: { ...ASKS_IN_REVIEW, when: [OWN_LINEAGE] },
    meaning: INTERRUPT_AGENT,
    input: interruptAgentInput,
    answer: sent,
    negative: unsent,
    refusals: ['no-calling-thread', ...INTERRUPT_REFUSALS, 'collaboration-refused'],
    subjects: (input, _raised: readonly Raised[] | undefined, actor) => writesTo(input.to, actor),
    raises: (input, raised: readonly Raised[] | undefined) => raised ?? [],
    confirmation: interruptQuestion,
    confirmLabel: 'Interrupt',
    presentation: COLLABORATION_WORDS.interrupt_agent,
  }),
  spawn_agent: operation('spawn_agent', {
    ...act,
    place: 'project',
    approval: { ...ASKS_IN_REVIEW, when: [NEW_WORKTREE, PLAIN_CHILD] },
    meaning: SPAWN_AGENT,
    input: spawning,
    answer: arms({
      started: {
        ...target,
        agentId: Schema.String,
        name: Schema.NullOr(Schema.String),
        model: Schema.NullOr(Schema.Struct({ provider: Schema.String, model: Schema.String, reasoning: Schema.NullOr(Schema.String) })),
        lowered: Schema.optional(Schema.Struct({ model: Schema.optional(Schema.String), reasoning: Schema.optional(Schema.String) })),
      },
    }),
    refusals: ['no-calling-thread', ...SPAWN_REFUSALS, ...PLACEMENT_REFUSALS, 'collaboration-refused'],
    subjects: (input, prepared: SpawnPrepared | undefined, actor) =>
      actor.kind === 'operator' ? [] : [{ kind: 'write' as const, value: spawnTypeSubject(signerPrincipal(actor), input.agentId) }],
    raises: (input, prepared: SpawnPrepared | undefined) => [
      ...worktreeRaised(input.worktree, prepared?.asking ?? null),
      ...plainRaised(input.plain),
    ],
    confirmation: (input) => ({
      summary: `Start ${input.name ?? input.agentId} on this work?`,
      facts: [
        { label: 'Agent', value: input.agentId },
        { label: 'Task', value: input.task },
      ],
      consequence: 'It runs in its own thread and owes you a final answer.',
    }),
    confirmLabel: 'Spawn',
    presentation: COLLABORATION_WORDS.spawn_agent,
  }),
  stop_agent: operation('stop_agent', {
    ...act,
    approval: { ...ASKS_IN_REVIEW, when: [NOT_A_CHILD] },
    meaning: STOP_AGENT,
    input: addressedChild,
    answer: arms({ stopped: target, stopping: target, 'not-running': target, spent: target }),
    refusals: ['no-calling-thread', ...CHILD_REFUSALS, 'collaboration-refused'],
    subjects: (input, crossing: readonly Raised[] | undefined, actor) => [...agent('write', input.threadId, actor)],
    raises: (input, crossing: readonly Raised[] | undefined, actor) => crossing ?? [],
    confirmation: (input) => ({ summary: `Stop the run of ${input.threadId}?` }),
    confirmLabel: 'Stop',
    presentation: COLLABORATION_WORDS.stop_agent,
  }),
  continue_agent: operation('continue_agent', {
    ...act,
    approval: { ...ASKS_IN_REVIEW, when: [NOT_A_CHILD] },
    meaning: CONTINUE_AGENT,
    input: addressedChild,
    answer: arms({ continued: { ...target, runId: Schema.String }, spent: target }),
    refusals: ['no-calling-thread', ...CHILD_REFUSALS, 'transport-cannot', 'collaboration-refused'],
    subjects: (input, crossing: readonly Raised[] | undefined, actor) => [...agent('write', input.threadId, actor)],
    raises: (input, crossing: readonly Raised[] | undefined, actor) => crossing ?? [],
    confirmation: (input) => ({ summary: `Continue the interrupted run of ${input.threadId}?` }),
    confirmLabel: 'Continue',
    presentation: COLLABORATION_WORDS.continue_agent,
  }),
};

export type CollaborationOperationId = keyof typeof COLLABORATION_OPERATIONS;
