import type { ToolRefusals } from '../agent/tool';
import { TRANSPORT_CANNOT_WAYS } from '../thread/record';

export const PLANE_REFUSALS = {
  'delegation-off': [
    'do the work in your own thread',
    'the operator asked for this agent in his own words, or the review policy you were told calls for this reviewer: start it with spawn_agent and `operatorAsked: true`',
    'the operator switches it back on: /delegation on the thread, or agent.delegation for the machine',
  ],
  'depth-exhausted': ['do the work in your own thread', 'the operator raises agent.subAgentDepth for this project'],
  'unknown-type': ['read_agent_library lists the agent definitions this project offers'],
  'type-withheld': ['start a type you are offered', 'the operator offers this one to agents'],
  'name-taken': ['start the child under another name, or with none and address it by thread id'],
  'spawn-spent': ['ask for the new work in a call of its own'],
  'spawn-conflict': ['ask for a changed child in a call of its own'],
  'spawn-not-ready': [
    'repeat spawn_agent with the same name and inputs to take up an unstarted child',
    'send_task to the child thread id to start it',
  ],
  'spawn-slots-full': ['spawn again once one of the started agents has ended', 'do the work in your own thread'],
  'budget-spent': ['do the work in your own thread', 'the operator raises the budget of this agent tree'],
  'harness-contract': ['start an agent type whose harness takes what you asked for', 'ask without the parameter the reason names'],
  'plain-fork': [
    'spawn the plain child without `fork`: its task carries what it needs',
    'spawn without `plain` to give the child your history',
  ],
  'plain-root': ['spawn the plain agent as your child: omit `link`', 'spawn the root without `plain`'],
  'model-unnamed': ['name the provider of the model'],
  'model-unserved': ['name a provider and model this server serves', 'omit them, and the child inherits yours'],
  'reasoning-unoffered': ['name a rung the chosen model offers', 'omit `reasoning`'],
  'switch-unoffered': ['name a switch and a value the chosen model offers', 'omit `switches`, and the child carries its standing ones'],
  'model-pinned': ['start a new agent on the model you need, with this one’s report as its brief'],
  'selection-empty': ['name the provider, the model or the reasoning rung'],
  'self-move': ['call set_agent_model from another thread so this run can finish its current step'],
  'thread-running': ['read list_agents for the current run; continue_agent resumes a stopped or failed turn'],
  'not-interrupted': ['send_task opens new work once the last turn completed'],
  'not-the-approver': ['the operator, or the parent named by the approval grant, answers this question'],
  'unknown-question': ['read the envelope that named the open question'],
  'answer-unoffered': ['answer with what the envelope names: `allow` for an approval, or one of the values it lists'],
  'answer-unwritten': ['answer the same question again'],
  'worktree-unplaced': ['start the child where you stand: omit `worktree`'],
  'home-unplaced': ['start the child in your own project: omit `project`'],
  'not-a-descendant': ['act on a thread of your own subtree: list_agents names each row’s parent', 'send the task without `compact`'],
  'not-a-child': ['act on a child of your own thread: list_agents names each row’s parent'],
  'thread-unknown': ['address a thread by the id list_agents prints'],
  'thread-archived': [
    'spawn a fresh agent briefed with its last report',
    'archive_thread with `archived: false` brings it back with everything put away with it; then send again',
  ],
  'transport-cannot': TRANSPORT_CANNOT_WAYS,
  'title-empty': ['send a title with at least one non-blank character, or omit `title`'],
  'key-reused': ['send the changed call under a key of its own'],
  'cold-wake': [
    'drop the named agents from `to` and send to the rest',
    'spawn a fresh agent briefed with the cold one’s last report',
    '`send_task` with `compact` where another model summarizes it',
    'send again with `wake: true`, for every recipient of the call, when that history is worth the full price',
  ],
} as const satisfies Readonly<Record<string, readonly [string, ...string[]]>>;

export type PlaneRefusalCode = keyof typeof PLANE_REFUSALS;

export const PLANE_REFUSAL_WORDS: Readonly<Record<PlaneRefusalCode, string>> = {
  'delegation-off': 'Delegation is off',
  'depth-exhausted': 'Agent depth limit reached',
  'unknown-type': 'Unknown agent type',
  'type-withheld': 'Agent type not offered',
  'name-taken': 'Name already taken',
  'spawn-spent': 'Agent already started',
  'spawn-conflict': 'Agent started differently before',
  'spawn-not-ready': 'Agent still starting',
  'spawn-slots-full': 'No free agent slots',
  'budget-spent': 'Agent budget spent',
  'harness-contract': 'Agent type cannot take this',
  'plain-fork': 'Plain agent takes no history',
  'plain-root': 'Plain agent needs a parent',
  'model-unnamed': 'Model provider not named',
  'model-unserved': 'Model not available',
  'reasoning-unoffered': 'Reasoning level not offered',
  'switch-unoffered': 'Model setting not offered',
  'model-pinned': 'Model is fixed',
  'selection-empty': 'Nothing chosen',
  'self-move': 'Cannot move its own model',
  'thread-running': 'A turn is running',
  'not-interrupted': 'Nothing to continue',
  'not-the-approver': 'Not the approver',
  'unknown-question': 'Unknown question',
  'answer-unoffered': 'Answer not offered',
  'answer-unwritten': 'Answer not recorded',
  'worktree-unplaced': 'Worktree not available',
  'home-unplaced': 'Project not available',
  'not-a-descendant': 'Not a descendant agent',
  'not-a-child': 'Not a child agent',
  'thread-unknown': 'Unknown agent',
  'thread-archived': 'Agent is archived',
  'transport-cannot': 'Transport cannot do this',
  'title-empty': 'Empty title',
  'key-reused': 'Call key already used',
  'cold-wake': 'Agent is cold',
};

export const planeRefusals = (codes: readonly PlaneRefusalCode[]): ToolRefusals =>
  Object.fromEntries(codes.map((code) => [code, PLANE_REFUSAL_WORDS[code]]));

export const SPAWN_REFUSALS = [
  'delegation-off',
  'depth-exhausted',
  'unknown-type',
  'type-withheld',
  'name-taken',
  'spawn-spent',
  'spawn-conflict',
  'spawn-not-ready',
  'spawn-slots-full',
  'budget-spent',
  'harness-contract',
  'plain-fork',
  'plain-root',
  'model-unnamed',
  'model-unserved',
  'reasoning-unoffered',
  'switch-unoffered',
  'worktree-unplaced',
  'home-unplaced',
  'thread-unknown',
  'thread-running',
  'transport-cannot',
  'title-empty',
] as const satisfies readonly PlaneRefusalCode[];

export const SEND_REFUSALS = ['thread-archived', 'key-reused'] as const satisfies readonly PlaneRefusalCode[];

export const TASK_REFUSALS = [
  'not-a-descendant',
  'thread-archived',
  'transport-cannot',
  'key-reused',
] as const satisfies readonly PlaneRefusalCode[];

export const INTERRUPT_REFUSALS = ['thread-archived', 'key-reused'] as const satisfies readonly PlaneRefusalCode[];

export const APPROVAL_REFUSALS = [
  'not-the-approver',
  'unknown-question',
  'answer-unoffered',
  'answer-unwritten',
] as const satisfies readonly PlaneRefusalCode[];

export const CHILD_REFUSALS = [
  'thread-unknown',
  'not-a-child',
  'thread-running',
  'not-interrupted',
  'key-reused',
] as const satisfies readonly PlaneRefusalCode[];

export class PlaneRefused extends Error {
  constructor(
    readonly code: PlaneRefusalCode,
    readonly reason: string,
    readonly unblock: readonly [string, ...string[]] = PLANE_REFUSALS[code],
  ) {
    super(`${code}: ${reason}`);
    this.name = 'PlaneRefused';
  }
}
