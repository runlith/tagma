import { Effect, Schema } from 'effect';
import { toolPageDisplay } from '../tool/page';
import { doorAsked, ToolFailed, Tool, type ToolAnswerOptions } from '../agent/tool';
import type { ToolDisplay, ToolDisplayFact } from '../tool/display';
import type { ToolCatalog } from '../agent/ToolCatalog';
import type { ThreadSummarizerSkip } from '../transcript/entries';
import { spawnTypeSubject, threadAgentSubject } from '../permissions/threadSubject';
import { FINAL_ANSWER_TOOL } from '../transcript/parts';
import type { ThreadChildCompacted, ThreadPlaneAccess } from './ThreadPlaneAccess';
import type { KeyedSpent } from '../thread/keyed';
import { THREAD_COMPACTION_POINTS } from '../thread/storage/inbox';
import { historyTools } from './historyTools';
import { sendTools } from './sendTools';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { modelName, type ModelNaming } from './agentLabel';
import { acting, addressed, addressedSoFar, crossingPrepared, handed, hostCall, told } from './toolCalls';
import { listedOutput, readRoster, rosterPage } from './agentRoster';
import { modelMenu } from './modelMenu';
import { modelChoiceWords, NO_REVIEW } from './team';
import {
  CONTINUE_AGENT,
  AgentAddress,
  CollaborationText,
  ANSWER_APPROVAL,
  LIST_AGENTS,
  SPAWN_AGENT,
  STOP_AGENT,
  childInput,
  raisedIds,
  continuedOutput,
  continuedText,
  answerApprovalInput,
  approvalOutput,
  approvalText,
  approvalWords,
  selectionWords,
  startedText,
  stoppedText,
  summarizerFacts,
  APPROVAL_REFUSAL_OF,
  approvalChoiceOf,
  approvalReason,
  type ApprovalRefusal,
  listAgentsInput,
  bornAt,
  bornElsewhere,
  spawnAgentInput,
  spawnAsk,
  spawnCopy,
  spawnSubscription,
  plainRaised,
  worktreeRaised,
  worktreeWords,
} from './collaborationVerbs';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../permissions/vocabulary';
import { Named, NEW_WORKTREE, NOT_A_CHILD, NOT_A_DESCENDANT, PLAIN_CHILD } from './collaborationVerbs';
import { APPROVAL_REFUSALS, CHILD_REFUSALS, PLANE_REFUSALS, planeRefusals, SPAWN_REFUSALS } from './refusals';
const approvalRefusal = (
  code: ApprovalRefusal,
  input: {
    readonly threadId: string;
    readonly questionId: string;
  },
) => new ToolFailed({ code, reason: approvalReason(code, input), unblock: PLANE_REFUSALS[code] });
export const READ_MODELS = 'read_models';
export const COLLABORATION_TOOL_NAMES: readonly string[] = [
  'list_agents',
  FINAL_ANSWER_TOOL,
  'send_task',
  'spawn_agent',
  'stop_agent',
  'continue_agent',
  'interrupt_agent',
  'answer_approval',
  'compact_agent',
  'rewind_agent',
  'set_agent_model',
  READ_MODELS,
];
export function collaborationTools(agents: ThreadPlaneAccess): ToolCatalog {
  const acts = (kind: 'read' | 'write', address: string) => [{ kind, value: threadAgentSubject(agents.ownerId, address) }];
  const onModel = (selection: ModelNaming, word: string): string | undefined => {
    const named = modelName(agents.models, selection);
    return named === undefined ? undefined : `${word} ${named}`;
  };
  const childVerbs = agents.startable.length > 0 && agents.models.modelsByCapability('text').length > 0;
  const tools: ToolCatalog = {
    list_agents: Tool.make({
      approval: ASKS_NEVER,
      description: LIST_AGENTS,
      parameters: listAgentsInput,
      document: true,
      subjects: () => acts('read', '*'),
      display: () => ({ form: 'none' }),
      execute: (input, call) =>
        acting(
          agents,
          call.caller,
          Effect.fnUntraced(function* (verbs) {
            const read = yield* readRoster(verbs.directory, input);
            if ('refused' in read) return yield* new ToolFailed({ reason: `${read.refused}: ${read.reason}; ${read.unblock}.` });
            const listed = listedOutput(read);
            return new Tool.ToolAnswer(listed, toolPageDisplay(rosterPage(read)), told(call, listed.page));
          }),
        ),
    }),
    ...sendTools(agents, childVerbs),
  };
  Object.assign(tools, historyTools(agents, childVerbs));
  tools.answer_approval = Tool.make({
    approval: ASKS_NEVER,
    exposure: 'deferred',
    description: ANSWER_APPROVAL,
    refusals: planeRefusals(APPROVAL_REFUSALS),
    parameters: answerApprovalInput,
    document: true,
    prepare: (input) => Effect.succeed({ subjects: acts('write', input.threadId) }),
    display: {
      streamFields: ['threadId', 'allow', 'value', 'values'],
      project: (input) => (input.threadId === undefined ? { form: 'none' } : handed([input.threadId], approvalWords(input))),
    },
    execute: (input, call) => {
      const choice = approvalChoiceOf(input);
      if (choice === null) return Effect.fail(approvalRefusal('answer-unoffered', input));
      return acting(agents, call.caller, (verbs) =>
        verbs.approvals.answer({ threadId: input.threadId, questionId: input.questionId, choice }),
      ).pipe(
        Effect.flatMap((answer) => {
          if (answer.status !== 'answered') return Effect.fail(approvalRefusal(APPROVAL_REFUSAL_OF[answer.status], input));
          const answered = approvalOutput(answer, input);
          return Effect.succeed(
            new Tool.ToolAnswer(
              answered,
              { ...addressed(input.threadId, undefined, answer), form: 'message', text: approvalWords(input) },
              told(call, approvalText(answered)),
            ),
          );
        }),
      );
    },
    mutates: true,
  });
  if (childVerbs) {
    tools.spawn_agent = Tool.make({
      approval: { ...ASKS_IN_REVIEW, when: [NEW_WORKTREE, PLAIN_CHILD] },
      description: SPAWN_AGENT,
      refusals: planeRefusals([...SPAWN_REFUSALS, 'key-reused']),
      parameters: spawnParameters(agents),
      document: true,
      claims: (input, call) =>
        Effect.succeed([
          {
            on: { kind: 'key', key: threadAgentSubject(agents.ownerId, input.name ?? `${input.agentId}:${call.toolCallId}`) },
            access: 'write',
          },
        ]),
      prepare: (input, call) =>
        acting(
          agents,
          call.caller,
          Effect.fnUntraced(function* (verbs) {
            const over = (yield* verbs.spawnLimits(input.link === 'root'))[0];
            if (over !== undefined)
              return yield* new Tool.ToolFailed({ code: over.code, reason: over.fact, unblock: PLANE_REFUSALS[over.code] });
            const home = input.project === undefined ? null : yield* verbs.spawnHome(input.project);
            const raised = [...worktreeRaised(input.worktree, home?.worktrees ?? agents.worktrees), ...plainRaised(input.plain)];
            return {
              subjects: [{ kind: 'write' as const, value: spawnTypeSubject(agents.ownerId, input.agentId) }],
              raised,
              prepared: { raised, home: bornElsewhere(home) },
            };
          }),
        ),
      display: {
        streamFields: ['agentId', 'name', 'model', 'reasoning', 'switches'],
        project: (input) => spawnDisplay(agents.models, input.name ?? input.agentId, onModel(input, 'on'), input),
      },
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs
            .spawn({
              ...spawnAsk(bornAt(input, call.prepared.home), call.toolCallId, call.prepared.raised),
              step: call.step,
            })
            .pipe(
              Effect.map(
                (started) =>
                  new Tool.ToolAnswer(
                    started,
                    spawnDisplay(agents.models, started.name ?? input.agentId, onModel(started.model ?? input, 'on'), {
                      agentId: input.agentId,
                      link: input.link,
                      task: input.task,
                      threadId: started.threadId,
                      projectId: started.projectId,
                      ...(started.model ?? {}),
                      switches: input.switches,
                      lowered: started.lowered,
                    }),
                    told(call, startedText(started)),
                  ),
              ),
            ),
        ),
      settleEffect: (call) =>
        hostCall(
          Effect.map(
            agents.spawnSettlement(call.caller, call.toolCallId, spawnCopy(call.toolInput), spawnSubscription(call.toolInput)),
            (settled) =>
              settled.status === 'completed'
                ? {
                    status: 'completed',
                    output: new Tool.ToolAnswer(
                      settled.output,
                      undefined,
                      told({ json: doorAsked(call.toolInput, 'json') }, startedText(settled.output)),
                    ),
                  }
                : settled,
          ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({
          summary: `Start ${input.name ?? input.agentId} on this work?`,
          facts: [
            { label: 'Agent', value: input.agentId },
            { label: 'Task', value: input.task },
          ],
          consequence: 'It runs in its own thread and owes you a final answer.',
        }),
        confirmLabel: 'Spawn',
      },
    });
    tools[READ_MODELS] = Tool.make({
      approval: ASKS_NEVER,
      exposure: 'deferred',
      description:
        'The catalog of models the installed providers offer, by provider: each one’s reasoning ladder, which are operator-only, and the switches with their values — what a row of the sub-agent list (`agent.models`) may name when the operator asks you to add or change one. `spawn_agent` and `set_agent_model` take the ids it names.',
      parameters: Schema.Struct({}),
      subjects: () => [],
      display: () => ({ form: 'none' }),
      execute: () => Effect.succeed(modelMenu(agents.menu ?? agents.models)),
    });
    tools.stop_agent = Tool.make({
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_CHILD] },
      exposure: 'deferred',
      description: STOP_AGENT,
      refusals: planeRefusals(CHILD_REFUSALS),
      parameters: childInput,
      document: true,
      prepare: (input, call) => crossingPrepared(agents, call.caller, acts('write', input.threadId), input.threadId, 'child'),
      display: (input) => addressedSoFar(input.threadId),
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs.stop({ threadId: input.threadId, key: call.toolCallId, asked: raisedIds(call.prepared) }).pipe(
            Effect.map(
              (stopped) =>
                new Tool.ToolAnswer(
                  stopped,
                  {
                    ...addressed(input.threadId, undefined, stopped),
                    facts:
                      stopped.status === 'stopping' || stopped.status === 'not-running'
                        ? [{ label: 'run', value: stopped.status.replace('-', ' ') }]
                        : undefined,
                    details: [{ label: 'state', value: stopped.status }],
                  },
                  told(call, stoppedText(stopped)),
                ),
            ),
          ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({ summary: `Stop the run of ${input.threadId}?` }),
        confirmLabel: 'Stop',
      },
    });
    tools.continue_agent = Tool.make({
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_CHILD] },
      exposure: 'deferred',
      description: CONTINUE_AGENT,
      refusals: planeRefusals([...CHILD_REFUSALS, 'transport-cannot']),
      parameters: childInput,
      document: true,
      prepare: (input, call) => crossingPrepared(agents, call.caller, acts('write', input.threadId), input.threadId, 'child'),
      display: (input) => addressedSoFar(input.threadId),
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs.continue({ threadId: input.threadId, key: call.toolCallId, asked: raisedIds(call.prepared) }).pipe(
            Effect.map((continued) => {
              const output = continuedOutput(continued);
              return new Tool.ToolAnswer(
                output,
                {
                  ...addressed(input.threadId, undefined, continued),
                  details: [output.status === 'spent' ? { label: 'state', value: 'spent' } : { label: 'run', value: output.runId }],
                },
                told(call, continuedText(output)),
              );
            }),
          ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({ summary: `Continue the interrupted run of ${input.threadId}?` }),
        confirmLabel: 'Continue',
      },
    });
    tools.set_agent_model = Tool.make({
      refusals: planeRefusals([
        ...CHILD_REFUSALS,
        'self-move',
        'selection-empty',
        'model-pinned',
        'model-unnamed',
        'model-unserved',
        'reasoning-unoffered',
      ]),
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_CHILD] },
      exposure: 'deferred',
      companions: [READ_MODELS],
      description:
        'Move a child onto another provider, model or rung: a working child finishes its step and continues there; a stopped one waits for `continue_agent`. ' +
        'A CLI agent stays on its own provider; a native one moves anywhere, Claude Code included. A non-child moves only with the operator’s consent; your own running thread refuses `self-move`.',
      parameters: Schema.Struct({
        threadId: AgentAddress,
        provider: Schema.optional(Named).annotate({ description: 'Absent, its own.' }),
        model: Schema.optional(Named).annotate({
          description: 'An id `read_models` lists; absent, its own or the new provider’s default.',
        }),
        reasoning: Schema.optional(Schema.NullOr(Named)).annotate({
          description: 'A rung the model offers; absent, its own where offered, else the default.',
        }),
      }),
      prepare: (input, call) => crossingPrepared(agents, call.caller, acts('write', input.threadId), input.threadId, 'child'),
      display: (input) => addressedSoFar(input.threadId, onModel(input, 'to')),
      execute: ({ threadId, provider, model, reasoning }, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs
            .move({
              threadId,
              key: call.toolCallId,
              asked: raisedIds(call.prepared),
              model: {
                provider: provider,
                model: model,
                reasoning: reasoning,
              },
            })
            .pipe(
              Effect.map((moved) =>
                'status' in moved
                  ? new Tool.ToolAnswer(moved, { ...addressed(threadId, undefined, moved), details: [{ label: 'state', value: 'spent' }] })
                  : new Tool.ToolAnswer(moved, {
                      ...addressed(threadId, onModel(moved.to, 'to'), moved),
                      facts: loweredFacts(agents.models, moved.lowered, moved.to),
                      details: [
                        { label: 'from', value: selectionWords(moved.from) },
                        { label: 'to', value: selectionWords(moved.to) },
                        ...loweredDetails(moved.lowered),
                      ],
                    }),
              ),
            ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({
          summary: `Move ${input.threadId} to ${[input.provider, input.model, input.reasoning].filter((part) => typeof part === 'string').join(' ') || 'another model'}?`,
          consequence: 'Its next turn runs on the new model over its own history.',
        }),
        confirmLabel: 'Move',
      },
    });
    tools.compact_agent = Tool.make({
      refusals: planeRefusals([...CHILD_REFUSALS, 'not-a-descendant', 'transport-cannot', 'cold-wake']),
      approval: { ...ASKS_IN_REVIEW, when: [NOT_A_DESCENDANT] },
      exposure: 'deferred',
      description:
        'Summarize a descendant agent’s history. An idle agent is compacted now, and the outcome — answered in place, or delivered as a notice with `background: true` — says ' +
        (agents.summarizerChoice
          ? 'who summarized, whose quota paid, and what was skipped; who summarizes is the operator’s choice, never the caller’s. '
          : 'who summarized and whose quota paid. ') +
        'A running agent needs `at` and the call answers at once with the accepted request: `step` compacts it at its next step and it works on, `end` once the work already queued for it is done; ' +
        '`joined` means a compaction already going answers the request. ' +
        '`keep` names facts the summary must retain. ' +
        'An idle agent whose cache is surely cold and whose context is large, summarized by its own model, refuses `cold-wake` unless `wake: true`.',
      parameters: Schema.Struct({
        threadId: AgentAddress,
        keep: Schema.optional(CollaborationText).annotate({
          description: 'What the summary must keep, in your words: what the next task will need at hand.',
        }),
        at: Schema.optional(Schema.Literals(THREAD_COMPACTION_POINTS)).annotate({
          description:
            'Where a running agent compacts: `step` at its next step, `end` after the work already queued for it. An idle agent with nothing queued compacts now either way.',
        }),
        wake: Schema.optional(Schema.Boolean).annotate({
          description:
            'Compact an idle agent whose cache is surely cold and context large on its own model anyway, at the full price of its history.',
        }),
      }),
      prepare: (input, call) => crossingPrepared(agents, call.caller, acts('write', input.threadId), input.threadId, 'descendant'),
      display: (input) => kept(addressedSoFar(input.threadId), input.keep),
      execute: (input, call) =>
        acting(agents, call.caller, (verbs) =>
          verbs
            .compact({
              threadId: input.threadId,
              key: call.toolCallId,
              asked: raisedIds(call.prepared),
              keep: input.keep,
              at: input.at,
              wake: input.wake,
            })
            .pipe(
              Effect.map(
                (compacted) =>
                  new Tool.ToolAnswer(
                    compacted,
                    { ...kept(addressed(input.threadId, undefined, compacted), input.keep), ...compactedFacts(compacted) },
                    compactionRefusal(compacted),
                  ),
              ),
            ),
        ),
      mutates: true,
      confirmation: {
        prompt: (input) => ({
          summary: `Compact the context of ${input.threadId}?`,
          facts: input.keep === undefined ? undefined : [{ label: 'Keep', value: input.keep }],
          consequence: 'Its history is folded into a summary; what it does next reads the shorter window.',
        }),
        confirmLabel: 'Compact',
      },
    });
  }
  return tools;
}
function kept(display: ToolDisplay, keep: string | undefined): ToolDisplay {
  return keep === undefined ? display : { ...display, form: 'message', text: keep };
}
type Lowered = { readonly model?: string; readonly reasoning?: string } | undefined;
function loweredFacts(catalog: ModelCatalog, lowered: Lowered, kept: ModelNaming): readonly ToolDisplayFact[] | undefined {
  if (lowered?.model === undefined && lowered?.reasoning === undefined) return undefined;
  const asked = modelName(catalog, { ...kept, model: lowered.model ?? kept.model, reasoning: lowered.reasoning ?? kept.reasoning });
  return asked === undefined ? undefined : [{ label: 'lowered from', value: asked }];
}
function loweredDetails(lowered: Lowered): readonly ToolDisplayFact[] {
  return [
    ...(lowered?.model === undefined ? [] : [{ label: 'lowered model', value: lowered.model }]),
    ...(lowered?.reasoning === undefined ? [] : [{ label: 'lowered reasoning', value: lowered.reasoning }]),
  ];
}
function spawnDisplay(
  catalog: ModelCatalog,
  title: string | undefined,
  subtitle: string | undefined,
  input: {
    readonly agentId?: string;
    readonly link?: 'child' | 'root';
    readonly task?: string;
    readonly threadId?: string;
    readonly projectId?: number;
    readonly provider?: string;
    readonly model?: string;
    readonly reasoning?: string | null;
    readonly switches?: Readonly<Record<string, string>>;
    readonly lowered?: {
      readonly model?: string;
      readonly reasoning?: string;
    };
  },
): ToolDisplay {
  return {
    form: 'message',
    title,
    subtitle,
    text: input.task ?? '',
    reference: input.threadId === undefined ? undefined : { kind: 'thread' as const, id: input.threadId, projectId: input.projectId },
    facts: loweredFacts(catalog, input.lowered, input),
    details: [
      ...(input.agentId === undefined ? [] : [{ label: 'agent', value: input.agentId }]),
      ...(input.link === 'root' ? [{ label: 'link', value: 'root' }] : []),
      ...(input.threadId === undefined ? [] : [{ label: 'thread', value: input.threadId }]),
      ...(input.provider === undefined ? [] : [{ label: 'provider', value: input.provider }]),
      ...(input.model === undefined ? [] : [{ label: 'model', value: input.model }]),
      ...(input.reasoning === undefined || input.reasoning === null ? [] : [{ label: 'reasoning', value: input.reasoning }]),
      ...Object.entries(input.switches ?? {}).map(([id, value]) => ({ label: id, value })),
      ...loweredDetails(input.lowered),
    ],
  };
}
function spawnParameters(agents: ThreadPlaneAccess) {
  return Schema.Struct({
    ...spawnAgentInput.fields,
    agentId: Schema.String.check(Schema.isMinLength(1)).annotate({
      description:
        `Agent to start: ${agents.startable.map((agent) => `${agent.id} (${agent.description})`).join('; ')}. ` +
        'Listed at run start; later ones start too.',
    }),
    ...SPAWN_MODEL_ARGUMENTS,
    model: Schema.optional(Named).annotate({
      description: modelChoiceWords(agents.team ?? { models: [], off: [], review: NO_REVIEW }),
    }),
    worktree: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
      description: worktreeWords(agents.worktrees),
    }),
  });
}
function compactionRefusal(compacted: ThreadChildCompacted | KeyedSpent): ToolAnswerOptions {
  if (compacted.status !== 'failed' && compacted.status !== 'aborted') return {};
  return {
    refusal: {
      code: `compaction-${compacted.status}`,
      reason: `The compaction run ${compacted.runId} ${compacted.status}.`,
      words: compacted.status === 'failed' ? 'Compaction failed' : 'Compaction stopped',
    },
  };
}
function compactedFacts(compacted: ThreadChildCompacted | KeyedSpent): Pick<ToolDisplay, 'facts' | 'details'> {
  switch (compacted.status) {
    case 'spent':
      return { details: [{ label: 'compaction', value: 'spent' }] };
    case 'requested':
      return {
        facts: [{ label: 'compacts', value: compacted.at === 'step' ? 'at its next step' : 'after its queued work' }],
        details: [
          { label: 'request', value: compacted.requestId },
          { label: 'run', value: compacted.runId },
        ],
      };
    case 'joined':
      return { facts: [{ label: 'compaction', value: 'already going' }], details: [{ label: 'run', value: compacted.runId }] };
    default: {
      const summarizer = compacted.summarizer;
      return {
        facts: [
          ...(compacted.status === 'unchanged' ? [{ label: 'compaction', value: 'unchanged' }] : []),
          { label: 'messages', value: `${compacted.history.before} → ${compacted.history.after}` },
          ...(compacted.skipped.length === 0 ? [] : [{ label: 'skipped', value: skippedWords(compacted.skipped) }]),
        ],
        details: [...(summarizer === null ? [] : summarizerFacts(summarizer)), { label: 'run', value: compacted.runId }],
      };
    }
  }
}
function skippedWords(skipped: readonly ThreadSummarizerSkip[]): string {
  return skipped
    .map((skip) => `${skip.provider}/${skip.model} ${skip.reason}${skip.until === undefined ? '' : ` until ${skip.until}`}`)
    .join('; ');
}
const SPAWN_MODEL_ARGUMENTS = {
  provider: Schema.optional(Named).annotate({
    description: 'The provider of the child’s model, as `read_models` lists it; absent, the profile’s, otherwise yours.',
  }),
  reasoning: Schema.optional(Schema.NullOr(Named)).annotate({
    description: 'A rung the chosen model offers; absent, the profile’s, otherwise yours.',
  }),
  switches: Schema.optional(Schema.Record(Schema.String, Named)).annotate({
    description:
      'Switch values by id, as `read_models` lists them; absent, a child on your model carries yours, the rest the operator’s standing choice.',
  }),
};
