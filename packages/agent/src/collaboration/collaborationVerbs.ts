import { Duration, Schema } from 'effect';
import { PAGE_CURSOR } from '@runlith/paging';
import type { ThreadForkCut, ThreadTarget } from '../thread/record';
import { TOOL_OUTPUT_MAX_BYTES, TOOL_OUTPUT_MAX_LINES } from '../agent/ToolOutputSpool';
import { WAKING_THREAD_EVENTS } from '../agent/contracts';
import { recipientsTitle } from './agentLabel';
import { AGENT_CEILING, AGENT_PAGE_ROWS } from './agentRoster';
import type { PermissionSubject } from '../permissions/vocabulary';
import { WORKTREE_NEW, type SpawnHome, type SpawnWorktrees } from './CollaborationConfig';
import type { ApprovalView, Condition, Raised } from '../permissions/vocabulary';
import type { OwnLineage } from './reach';
import type {
  ThreadAddressUnknown,
  ThreadCompactRefused,
  ThreadDeliveryPending,
  ThreadEnvelopeReceipt,
  ThreadEnvelopeRecipient,
  ThreadSendRefused,
} from './ThreadEnvelopes';
import type {
  ThreadApprovalAnswer,
  ThreadChildContinued,
  ThreadChildStopped,
  ThreadChildSummarizer,
  ThreadSendAnswer,
  SpawnSubscription,
  ThreadSpawnAsk,
  ThreadSpawnResult,
} from './ThreadPlaneAccess';
import type { ToolRefusal } from '../agent/tool';
import type { ToolDisplayFact } from '../tool/display';
import { refusalLines } from '../tool/refusal';
import type { ApprovalAnswered, ApprovalChoice } from '../thread/run/ApprovalAnswers';
import { PLANE_REFUSAL_WORDS, PLANE_REFUSALS, type APPROVAL_REFUSALS } from './refusals';
import { coldReason } from './wakeCost';

const TEXT_MAX_CHARS = 20_000;

export const CollaborationText = Schema.String.check(Schema.isBetweenLength(1, TEXT_MAX_CHARS));

export const AgentAddress = Schema.String.check(Schema.isMinLength(1)).annotate({
  description: 'The agent`s name inside this team, or its thread id.',
});

const SAMPLE_ID = '01a121d6-3d32-71e9-bb7e-606acf893aa6';

const REASON_MAX_CHARS = 160;

const NAME_MAX_CHARS = 64;

const WIDE = '語';

const RECEIPT_SAMPLE: ThreadEnvelopeReceipt = {
  envelopeId: `envelope:interrupt:${SAMPLE_ID}:${'k'.repeat(40)}:149`,
  intent: 'interrupt',
  status: 'delivered',
  runId: SAMPLE_ID,
  acted: true,
  recipient: { threadId: SAMPLE_ID, projectId: Number.MAX_SAFE_INTEGER, name: WIDE.repeat(NAME_MAX_CHARS), sameTeam: false },
  acceptance: { status: 'unconfirmed', reason: WIDE.repeat(REASON_MAX_CHARS) },
  cache: 'warm until 23:59Z · 999k',
};

const RECEIPT_RENDERED = JSON.stringify({ deliveries: [RECEIPT_SAMPLE] }, null, 2);

const ANSWER_RESERVE_BYTES = 512;

export const RECIPIENT_CEILING = Math.min(
  Math.floor((TOOL_OUTPUT_MAX_BYTES - ANSWER_RESERVE_BYTES) / new TextEncoder().encode(RECEIPT_RENDERED).length),
  Math.floor(TOOL_OUTPUT_MAX_LINES / RECEIPT_RENDERED.split('\n').length),
);

export const AgentRecipients = Schema.Array(AgentAddress)
  .check(Schema.isMinLength(1), Schema.isMaxLength(RECIPIENT_CEILING))
  .annotate({
    description: `The agents to reach, always a list: one agent is a list of one, at most ${RECIPIENT_CEILING}. Each receives the words alone, unaware of the others.`,
  });

export const ThreadWakes = Schema.Array(Schema.Literals(WAKING_THREAD_EVENTS)).annotate({
  description:
    'The events of a subscribed thread that start a turn of yours while you are idle: `rested`, `failed`, `stalled`, `awaiting`, `addresses-human`; `[]` wakes on none. Omitted: all five. Every other event waits for your next step.',
});

export const LIST_AGENTS =
  'List server agents with type, activity, last-run outcome, context usage, prompt-cache warmth and parent thread; working agents first. ' +
  'A run with no durable movement past the widest gap its bounds allow reads `stalled since` — its heartbeat is no proof of progress. ' +
  'Use a name only within your own root/team; otherwise address by thread id. The page footer gives the continuation call.';

export const listAgentsInput = Schema.Struct({
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(AGENT_CEILING))).annotate({
    description: `How many rows to answer, ${AGENT_PAGE_ROWS} by default and ${AGENT_CEILING} at most. The answer carries the total and the cursor, so a cut is never silent.`,
  }),
  cursor: PAGE_CURSOR,
});

const WAKE_WORDS =
  'Wake every idle descendant of this call even where its prompt cache is surely cold and its context large: the send rewrites that whole context at full price. Without it, such a send refuses `cold-wake` and sends nothing.';

export const SEND_MESSAGE =
  'Send a message to one agent or to several at once, by name or thread id. A working agent reads it at its next step; an idle agent starts a turn over its whole context — send it only what it must act on now. ' +
  'An ordinary message is owed no answer: whoever needs one sends `send_task`. For a reply, pass the received envelope id as inReplyTo. ' +
  'With `final: true` it is your final answer to the one agent that started you or gave you work with `send_task`: it arrives as that agent’s report, ' +
  'from whichever run you are in, and ends what you owed it. It refuses `no-open-request` when you owe that agent nothing.';

export const sendMessageInput = Schema.Struct({
  to: AgentRecipients,
  message: CollaborationText,
  inReplyTo: Schema.optional(Schema.String).annotate({
    description: 'The id of the envelope this answers, when it answers one. Never beside `final`.',
  }),
  final: Schema.optional(Schema.Boolean).annotate({
    description:
      'Send this as your final answer to the work this one agent gave you: it closes every request of it you hold. Omit it for an ordinary message.',
  }),
  wake: Schema.optional(Schema.Boolean).annotate({ description: WAKE_WORDS }),
});

export const SEND_TASK =
  'Queue work for one agent, or the same work for several, by name or thread id. An idle agent starts now; a working agent starts it after its current turn. ' +
  'Each recipient owes you a final answer for it. An idle descendant whose cache is surely cold and whose context is large refuses `cold-wake` unless `wake: true`.';

const COMPACTED_FIRST =
  ' With `compact`, a descendant of yours is compacted first — an idle one now, a working one once the work already queued for it is done — and the task stands directly behind that compaction in its queue, opening on the compacted context.';

export function compactWords(summarizerChoice: boolean): string {
  return (
    COMPACTED_FIRST +
    (summarizerChoice
      ? ' Who summarizes is the operator’s choice, never yours; read_compaction_choices shows it and its cost beforehand. An idle agent’s summarizer is resolved now and named in `compaction.summarizer`: when none can be spent the send refuses `no-summarizer` and queues nothing. ' +
        'A working agent’s is resolved when its compaction is taken, and the task opens whether or not the compaction ran.'
      : ' The agent’s own model summarizes it.')
  );
}

export const COMPACT_OUTCOMES =
  COMPACTED_FIRST +
  ' An idle agent’s summarizer is resolved now and named in `compaction.summarizer`; where none can be spent the send answers `no-summarizer` and queues nothing; a working agent’s task opens whether or not its compaction ran. ' +
  'A child that keeps its context outside the model runtime refuses `transport-cannot` naming `compaction`.';

export const taskInput = Schema.Struct({
  to: AgentRecipients,
  task: CollaborationText,
  wake: Schema.optional(Schema.Boolean).annotate({ description: WAKE_WORDS }),
});

export const compactingTaskInput = Schema.Struct({
  ...taskInput.fields,
  compact: Schema.optional(
    Schema.Struct({
      keep: Schema.optional(CollaborationText).annotate({
        description: 'What the summary must keep, in your words; absent, the task itself.',
      }),
    }),
  ).annotate({
    description: 'Compact the agent’s history before the task opens on it: one descendant of yours per call.',
  }),
});

export const INTERRUPT_AGENT =
  'Interrupt the current turn of another agent, or of several at once, preserving each. Its next turn receives your reason. Does nothing to an agent that is not working. Any agent but your own thread and its ancestors.';

export const interruptAgentInput = Schema.Struct({ to: AgentRecipients, reason: CollaborationText });

function sendQuestion(to: readonly string[], summary: string, words: ApprovalView['facts'][number]): ApprovalView {
  return { summary, facts: [...(to.length > 1 ? [{ label: 'To', value: to.join(', ') }] : []), words] };
}

export function messageQuestion(input: {
  readonly to: readonly string[];
  readonly message: string;
  readonly final?: boolean;
}): ApprovalView {
  const whom = recipientsTitle(input.to);
  return sendQuestion(input.to, input.final === true ? `Send this to ${whom} as your final answer?` : `Send this to ${whom}?`, {
    label: 'Message',
    value: input.message,
  });
}

export function taskQuestion(input: {
  readonly to: readonly string[];
  readonly task: string;
  readonly compact?: { readonly keep?: string };
}): ApprovalView {
  const whom = recipientsTitle(input.to);
  if (input.compact === undefined) return sendQuestion(input.to, `Give ${whom} this work?`, { label: 'Task', value: input.task });
  return {
    summary: `Compact the context of ${whom}, then give it this work?`,
    facts: [
      { label: 'Task', value: input.task },
      { label: 'Keep', value: input.compact.keep ?? input.task },
    ],
    consequence: 'Its history is folded into a summary before the task opens.',
  };
}

export function interruptQuestion(input: { readonly to: readonly string[]; readonly reason: string }): ApprovalView {
  const whom = recipientsTitle(input.to);
  return {
    ...sendQuestion(input.to, input.to.length === 1 ? `Cut ${whom}'s current turn short?` : `Cut the current turns of ${whom} short?`, {
      label: 'Reason',
      value: input.reason,
    }),
    consequence: 'Each agent survives; your reason is what its next turn opens on.',
  };
}

export const ANSWER_APPROVAL =
  'Answer a question of your team that its approval envelope puts to you. An approval takes `allow` — the act runs, otherwise it is declined with your `note`. ' +
  'A choice takes the one `value` the envelope lists, or your own words where it takes them; a choice of several `values`; a question of several prompts `answers`, one per prompt id. ' +
  'Decide as the operator would; the operator can answer it themselves. A question that is not yours refuses `not-the-approver`, an answer the question does not take `answer-unoffered`.';

export const answerApprovalInput = Schema.Struct({
  threadId: AgentAddress,
  questionId: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The question named by the approval envelope.' }),
  allow: Schema.optional(Schema.Boolean).annotate({ description: 'The answer to an approval.' }),
  value: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
    description: 'The answer to a choice: one value its envelope lists, or your own words where it takes them.',
  }),
  values: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1))).annotate({
    description: 'The answer to a choice of several: the values its envelope lists that you pick.',
  }),
  answers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        questionId: Schema.String.check(Schema.isMinLength(1)),
        values: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1)),
      }),
    ).check(Schema.isMinLength(1)),
  ).annotate({ description: 'The answer to a question of several prompts: one entry per prompt id its envelope lists.' }),
  note: Schema.optional(CollaborationText).annotate({ description: 'Why, in a line; a declined act reaches the asking thread with it.' }),
});

export const approvalChoiceOf = (input: typeof answerApprovalInput.Type): ApprovalChoice | null => {
  const given = [input.allow, input.value, input.values, input.answers].filter((each) => each !== undefined).length;
  if (given !== 1) return null;
  if (input.allow !== undefined) return { allow: input.allow, note: input.note };
  if (input.answers !== undefined) return { answers: input.answers };
  return { values: input.values ?? [input.value!] };
};

export type ApprovalRefusal = (typeof APPROVAL_REFUSALS)[number];

export const APPROVAL_REFUSAL_OF = {
  'not-the-approver': 'not-the-approver',
  unknown: 'unknown-question',
  unoffered: 'answer-unoffered',
  unwritten: 'answer-unwritten',
} as const satisfies Record<Exclude<ApprovalAnswered, 'answered'>, ApprovalRefusal>;

export function approvalReason(code: ApprovalRefusal, input: { readonly threadId: string; readonly questionId: string }): string {
  if (code === 'not-the-approver') return `Question ${input.questionId} is not put to this thread.`;
  if (code === 'unknown-question') return `${input.threadId} holds no open question ${input.questionId}.`;
  if (code === 'answer-unwritten') return `The CLI did not take this answer to ${input.questionId}; the question stays open.`;
  return `Question ${input.questionId} takes \`allow\` when it is an approval, and one offered \`value\` — or \`values\` where it takes several — when it is a choice; one of them, never two.`;
}

export const SPAWN_AGENT =
  'Start an agent on `task`: a child of yours, or with `link: "root"` an independent thread outside your tree. Its final answer, from whichever run, is a report opening a turn of yours; without one, the run where your task’s work ended — the first that ends with nothing it started still owing it a report — reports its last message, a failed or cut run its diagnosis, its other runs nothing. ' +
  'Keep working; end your turn when nothing is left. The agent receives only `task` unless `fork` adds history: include all needed context, and give parallel agents disjoint scopes.';

const LINK_OUTCOMES =
  '`child` (default): a member of your team, within the configured depth, that you stop, continue, rewind and steer. ' +
  '`root`: a thread leading a team of its own outside your tree, addressed by its thread id; `task` still owes you its final answer, nothing ties it to you after that, and acting on it takes the operator’s word.';

export function worktreeWords(worktrees: SpawnWorktrees | null): string {
  const named = 'or a worktree name in the child’s home project';
  if (worktrees === null) return 'This host places no child elsewhere: omit it, and the child works where you stand.';
  return `\`inherit\` (default: where you stand), \`new\` (a fresh worktree cut from there${worktrees === 'allow' ? '' : ', approved by the operator first'}) ${named}; under another \`project\`, from its main checkout. Isolate only work that must not touch your tree; a reviewer reads yours.`;
}

const WORKTREE_OUTCOMES =
  '`inherit` (the default: the child works in the worktree you stand in), `new` — a fresh worktree cut from where you stand — or a worktree name in the child’s home project. ' +
  'When `project` selects another home, absent or `inherit` uses its main checkout, and `new` cuts from there. ' +
  'A host that places no child elsewhere refuses every value but `inherit` with `worktree-unplaced`.';

const PROJECT_OUTCOMES =
  'The child’s home — thread list, agent definitions, law — by project name or id; `tagma` is the server’s source project, `global` is the shared graph. Its reports still come to you. Omitted: your home.';

const PLAIN_OUTCOMES =
  'Only on the operator’s word: a native agent taking your every task, interrupt and message as the operator’s own — no envelope, birth note or team — though your tasks’ runs still report to you. Another harness refuses `harness-contract`.';

export function plainRaised(plain: boolean | undefined): readonly Raised[] {
  if (plain !== true) return [];
  return [{ condition: PLAIN_CHILD.id, fact: 'the child takes every word you send it for the operator’s own' }];
}

export const WORKTREE_CONSENT = 'new-worktree';

export function worktreeRaised(worktree: string | undefined, asking: SpawnWorktrees | null): readonly Raised[] {
  if (worktree !== WORKTREE_NEW || asking === null || asking === 'allow') return [];
  return [{ condition: NEW_WORKTREE.id, fact: 'the child cuts a worktree of its own: a branch and a checkout of this repository on disk' }];
}

export function lineageRaised(found: readonly OwnLineage[]): readonly Raised[] {
  return found.map(({ thread, lineage }) => {
    const whom = thread.name ?? thread.id;
    return {
      condition: 'own-lineage',
      fact:
        lineage === 'self'
          ? `${whom} is the calling thread itself: the turn making this call is cut short`
          : `${whom} is an ancestor of the calling thread: the turn cut short is one this thread descends from`,
    };
  });
}

export const Named = Schema.String.check(Schema.isMinLength(1));

export const SWITCHES_RULE =
  'Model switches the child starts with, by switch id: a value named here replaces the one it would carry. ' +
  'Absent, a child on its parent’s model carries the parent’s switches, and every switch the parent sets no value for takes the operator’s standing choice for the child’s model.';

export const spawnAgentInput = Schema.Struct({
  agentId: Named.annotate({
    description: 'The agent definition to start, by id, resolved in the child’s home project.',
  }),
  provider: Schema.optional(Named).annotate({
    description:
      'The provider that serves the child’s model; one this server does not serve refuses `model-unserved`. Absent, the profile’s provider, and otherwise this thread’s.',
  }),
  model: Schema.optional(Named).annotate({
    description: 'The model the spawned agent runs on; one this server does not serve refuses `model-unserved`. Absent, it inherits yours.',
  }),
  reasoning: Schema.optional(Schema.NullOr(Named)).annotate({
    description:
      'A rung the chosen model offers; naming one it does not offer refuses `reasoning-unoffered`. Absent, the profile’s rung, and otherwise this thread’s.',
  }),
  switches: Schema.optional(Schema.Record(Schema.String, Named)).annotate({
    description: `${SWITCHES_RULE} One the chosen model does not offer refuses \`switch-unoffered\`.`,
  }),
  task: CollaborationText.annotate({ description: 'The agent’s task or opening message.' }),
  link: Schema.optional(Schema.Literals(['child', 'root'])).annotate({ description: LINK_OUTCOMES }),
  fork: Schema.optional(
    Schema.Union([Schema.Literals(['all', 'none']), Schema.Int.check(Schema.isGreaterThan(0)), Schema.Struct({ before: Named })]),
  ).annotate({
    description:
      'History to copy, of yours or of `forkFrom`: `all`, `none`, the last N turns, or `{before: <run id>}` — the history a rewind to that run would leave, without its turn and every later one.',
  }),
  forkFrom: Schema.optional(Named).annotate({
    description:
      'A thread you can address, by name or thread id, whose history `fork` copies instead of yours; `fork` defaults to `all`. The agent starts on that thread’s model unless `model` names one. A running source refuses `thread-running`.',
  }),
  name: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, NAME_MAX_CHARS))).annotate({
    description:
      'A team-local address, reserved while the thread lives, even archived; a collision refuses `name-taken`. Omitted: the thread id.',
  }),
  title: Schema.optional(Schema.String).annotate({
    description: 'The thread’s title, kept as sent and never renamed automatically; a blank one refuses `title-empty`.',
  }),
  host: Schema.optional(Schema.Struct({ kind: Named, id: Named })).annotate({
    description:
      'Only a kind/id binding a host operation returned here, checked at spawn; default this thread’s host; never beside `fork`.',
  }),
  project: Schema.optional(Schema.Union([Named, Schema.Int])).annotate({ description: PROJECT_OUTCOMES }),
  worktree: Schema.optional(Named).annotate({ description: WORKTREE_OUTCOMES }),
  plain: Schema.optional(Schema.Boolean).annotate({ description: PLAIN_OUTCOMES }),
  subscribe: Schema.optional(Schema.Struct({ wakes: Schema.optional(ThreadWakes) })).annotate({
    description: 'Subscribe to the agent in the same act, before its first run can end, as subscribe_threads would; `wakes` as there.',
  }),
});

export type SpawnInput = typeof spawnAgentInput.Type;

export function bornElsewhere(home: SpawnHome | null): number | undefined {
  return home === null || home.projectId === home.parentProjectId ? undefined : home.projectId;
}

export function bornAt(input: SpawnInput, home: number | undefined): SpawnInput {
  const { project: _named, ...asked } = input;
  return home === undefined ? asked : { ...asked, project: home };
}

export function raisedIds(asked: readonly Raised[]): readonly string[] {
  return asked.map((raised) => raised.condition);
}

export function spawnAsk(input: SpawnInput, requestId: string, asked: readonly Raised[]): ThreadSpawnAsk {
  const model = modelAsk(input);
  const consented = raisedIds(asked);
  return {
    requestId,
    asked: consented.length === 0 ? undefined : consented,
    agentId: input.agentId,
    task: input.task,
    name: input.name,
    root: input.link === 'root',
    title: input.title,
    fork: input.fork !== undefined ? forkCutOf(input.fork) : input.forkFrom !== undefined ? { kind: 'all' } : undefined,
    forkFrom: input.forkFrom,
    model: model,
    switches: input.switches,
    host: input.host,
    project: input.project,
    worktree: input.worktree,
    plain: input.plain,
    subscribe: input.subscribe,
  };
}

const isSubscribingAsk = Schema.is(Schema.Struct({ subscribe: spawnAgentInput.fields.subscribe }));

export function spawnSubscription(input: unknown): SpawnSubscription | undefined {
  return isSubscribingAsk(input) ? input.subscribe : undefined;
}

function forkCutOf(carry: NonNullable<SpawnInput['fork']>): ThreadForkCut {
  if (typeof carry === 'number') return { kind: 'turns', turns: carry };
  return typeof carry === 'string' ? { kind: carry } : { kind: 'before', runId: carry.before };
}

function modelAsk(input: SpawnInput): ThreadSpawnAsk['model'] {
  if (input.provider === undefined && input.model === undefined && input.reasoning === undefined) return undefined;
  return {
    provider: input.provider,
    model: input.model,
    reasoning: input.reasoning,
  };
}

const BEYOND_CHILDREN = '';

export const STOP_AGENT = 'Stop the active run of a child agent thread spawned from this thread.' + BEYOND_CHILDREN;

export const CONTINUE_AGENT =
  'Resume this thread’s interrupted child run (stopped, restarted or failed) from saved history. Returns the new run. Refuses a running child or one whose last turn completed.' +
  BEYOND_CHILDREN;

export const childInput = Schema.Struct({ threadId: AgentAddress });

export function continuedOutput(continued: ThreadChildContinued) {
  return 'status' in continued ? { ...continued, status: 'spent' as const } : { ...continued, status: 'continued' as const };
}

type RefusalWords = { readonly words: string; readonly reason: string; readonly unblock: readonly string[] };

const REFUSALS: Record<Exclude<(ThreadSendRefused | ThreadCompactRefused)['code'], 'cold-wake'>, RefusalWords> = {
  'no-open-request': {
    words: 'No request to answer',
    reason:
      'You owe this agent no final answer now: nothing it asked of you has reached one of your runs yet, or what it asked was already answered finally.',
    unblock: ['Send it without `final`: an ordinary message, owed no answer.'],
  },
  'final-in-reply': {
    words: 'Final answer names no envelope',
    reason: 'A final answer is filed against the newest request its addressee gave you, so it names no envelope of its own.',
    unblock: ['Drop `inReplyTo` and send the final answer again.'],
  },
  'final-to-many': {
    words: 'Final answer goes to one agent',
    reason: 'A final answer closes what one agent asked of you, so it goes to one agent per call; nothing was sent.',
    unblock: ['Send the final answer to each agent you owe one in a call of its own.'],
  },
  'compact-to-many': {
    words: 'Compaction goes to one agent',
    reason:
      'A compaction is chosen for one child at a time, by its own warmth and fill, so a task behind one goes to one agent per call; nothing was sent.',
    unblock: [
      'Send the task to each child that needs a compaction in a call of its own.',
      'Send the task to all of them at once without `compact`.',
    ],
  },
  'no-summarizer': {
    words: 'No summarizer available',
    reason:
      'No summarizer the operator allows can be spent now — `skipped` names each one passed over and why — so nothing was compacted and the task was not queued.',
    unblock: [
      'Send the task without `compact`: the agent opens it on its whole context.',
      'Spawn a fresh agent with this one’s last report as its brief.',
    ],
  },
};

function refusalWords(answer: ThreadSendRefused | ThreadCompactRefused): RefusalWords {
  return answer.code === 'cold-wake'
    ? { words: PLANE_REFUSAL_WORDS['cold-wake'], reason: coldReason(answer.cold), unblock: PLANE_REFUSALS['cold-wake'] }
    : REFUSALS[answer.code];
}

function unsentOutput(answer: ThreadAddressUnknown | ThreadSendRefused | ThreadCompactRefused) {
  if (answer.status === 'refused') {
    const { reason, unblock } = refusalWords(answer);
    return { ...answer, reason, unblock };
  }
  return {
    ...answer,
    reason: `No agent answers to ${answer.addresses.join(', ')}, so nothing was sent to anyone.`,
    unblock: [
      answer.addressable.length > 0
        ? `Address one of the names your own team answers to: ${answer.addressable.join(', ')}.`
        : 'No agent in your own team carries a name, so address by thread id.',
      'An agent of another team is reached by its thread id — `list_agents` prints it on every row, beside the `root` that says which team the row belongs to.',
    ],
  };
}

export function sendRefusal(answer: ThreadSendAnswer): ToolRefusal | undefined {
  if (answer.status === 'refused') {
    const said = refusalWords(answer);
    return { code: answer.code, reason: said.reason, words: said.words };
  }
  if (answer.status === 'not-found')
    return { code: 'not-found', reason: `No agent answers to ${answer.addresses.join(', ')}.`, words: 'No such agent' };
  return undefined;
}

const clipped = (text: string) => (text.length > REASON_MAX_CHARS ? `${text.slice(0, REASON_MAX_CHARS - 1)}…` : text);

function deliveryOutput(receipt: ThreadEnvelopeReceipt | ThreadDeliveryPending): ThreadEnvelopeReceipt | ThreadDeliveryPending {
  if (receipt.status === 'pending') return { ...receipt, failure: clipped(receipt.failure) };
  const acceptance = receipt.acceptance;
  return acceptance?.status === 'unconfirmed' ? { ...receipt, acceptance: { ...acceptance, reason: clipped(acceptance.reason) } } : receipt;
}

export function sentOutput(answer: ThreadSendAnswer) {
  return answer.status === 'refused' || answer.status === 'not-found'
    ? unsentOutput(answer)
    : { status: answer.status, deliveries: answer.deliveries.map(deliveryOutput) };
}

export type SentOutput = ReturnType<typeof sentOutput>;

export type ContinuedOutput = ReturnType<typeof continuedOutput>;

type ApprovalChosen = {
  readonly questionId: string;
  readonly allow?: boolean;
  readonly value?: string;
  readonly values?: readonly string[];
  readonly answers?: readonly { readonly questionId: string; readonly values: readonly string[] }[];
};

export type ApprovalOutput = ThreadTarget & ApprovalChosen & { readonly status: 'answered' };

export function approvalOutput(answer: ThreadApprovalAnswer, input: ApprovalChosen): ApprovalOutput {
  return {
    ...answer,
    status: 'answered' as const,
    questionId: input.questionId,
    allow: input.allow,
    value: input.value,
    values: input.values,
    answers: input.answers,
  };
}

export function approvalWords(input: {
  readonly value?: string;
  readonly values?: readonly string[];
  readonly answers?: readonly { readonly values: readonly string[] }[];
  readonly allow?: boolean;
  readonly note?: string;
}): string {
  return (
    input.value ??
    input.values?.join(', ') ??
    input.answers?.map((answer) => answer.values.join(', ')).join('; ') ??
    (input.allow === true ? 'allowed' : (input.note ?? 'declined'))
  );
}

export function selectionWords(selection: {
  readonly provider: string;
  readonly model: string | null;
  readonly reasoning: string | null;
}): string {
  const pair = `${selection.provider}/${selection.model ?? 'default'}`;
  return selection.reasoning === null ? pair : `${pair} ${selection.reasoning}`;
}

export function summarizerFacts(summarizer: ThreadChildSummarizer): readonly ToolDisplayFact[] {
  return [
    { label: 'summarized by', value: `${selectionWords(summarizer)}${summarizer.own ? ', its own model' : ''}` },
    { label: 'paid by', value: `${summarizer.provider} ${summarizer.account ?? 'default account'}` },
  ];
}

const whom = (recipient: ThreadEnvelopeRecipient): string =>
  recipient.name === null ? recipient.threadId : `${recipient.name} (${recipient.threadId})`;

function deliveryLine(receipt: ThreadEnvelopeReceipt | ThreadDeliveryPending): string {
  const envelope = `envelope ${receipt.envelopeId}`;
  if (receipt.status === 'pending') return `${whom(receipt.recipient)} — ${receipt.intent} not delivered: ${receipt.failure}; ${envelope}`;
  const compaction = receipt.compaction;
  return [
    `${whom(receipt.recipient)} — ${receipt.intent} ${receipt.status}${receipt.runId === null ? '' : `, run ${receipt.runId}`}`,
    envelope,
    ...(receipt.recipient.sameTeam ? [] : ['another team']),
    ...(receipt.closed === undefined
      ? []
      : [`closed ${receipt.closed.length === 0 ? 'no request' : `requests ${receipt.closed.join(', ')}`}`]),
    ...(receipt.acceptance?.status === 'unconfirmed' ? [`acceptance unconfirmed: ${receipt.acceptance.reason}`] : []),
    ...(compaction === undefined
      ? []
      : [
          `behind ${compaction.runId === null ? 'a queued compaction' : `compaction run ${compaction.runId}`}, request ${compaction.requestId}`,
          ...(compaction.summarizer === null ? [] : summarizerFacts(compaction.summarizer).map((fact) => `${fact.label} ${fact.value}`)),
        ]),
    ...(receipt.cache === undefined ? [] : [`cache ${receipt.cache}`]),
  ].join('; ');
}

export function sentText(answer: SentOutput): string {
  if (answer.status === 'sent') return answer.deliveries.map(deliveryLine).join('\n');
  const code = answer.status === 'refused' ? answer.code : 'not-found';
  const skipped =
    'skipped' in answer
      ? [
          `skipped: ${answer.skipped
            .map((skip) => `${skip.provider}/${skip.model} ${skip.reason}${skip.until === undefined ? '' : ` until ${skip.until}`}`)
            .join('; ')}`,
        ]
      : [];
  return [...refusalLines({ code, reason: answer.reason, unblock: answer.unblock }), ...skipped].join('\n');
}

export function startedText(started: ThreadSpawnResult): string {
  const { model, lowered } = started;
  const asked =
    lowered === undefined || model === null
      ? ''
      : `, lowered from ${lowered.model ?? model.model}${lowered.reasoning === undefined ? '' : ` ${lowered.reasoning}`}`;
  return `started ${started.name ?? started.agentId} as thread ${started.threadId}${
    started.projectId === undefined ? '' : ` in project ${started.projectId}`
  }${model === null ? '' : `, on ${selectionWords(model)}`}${asked}`;
}

const SPENT_WORDS = 'this call already acted under its key, and what it answered is no longer kept';

const STOPPED_WORDS: Readonly<Record<ThreadChildStopped['status'], string>> = {
  stopped: 'its run stopped',
  stopping: 'its run is stopping',
  'not-running': 'no run of it was going',
  spent: SPENT_WORDS,
};

export const stoppedText = (stopped: ThreadChildStopped): string => `${stopped.threadId}: ${STOPPED_WORDS[stopped.status]}`;

export const continuedText = (continued: ContinuedOutput): string =>
  `${continued.threadId}: ${continued.status === 'continued' ? `continues as run ${continued.runId}` : SPENT_WORDS}`;

export const approvalText = (answered: ApprovalOutput): string =>
  `${answered.threadId}: question ${answered.questionId} answered — ${approvalWords(answered)}`;

const TEN_MINUTES = Duration.minutes(10);

export const NOT_A_CHILD: Condition = { id: 'not-a-child', label: 'Not a child', asksFrom: 'review', timeout: TEN_MINUTES };

export const NOT_A_DESCENDANT: Condition = {
  id: 'not-a-descendant',
  label: 'Outside the subtree',
  asksFrom: 'review',
  timeout: TEN_MINUTES,
};

export const OWN_LINEAGE: Condition = { id: 'own-lineage', label: 'Own lineage', asksFrom: 'review', timeout: 'none' };

export const NEW_WORKTREE: Condition = { id: WORKTREE_CONSENT, label: 'New worktree', asksFrom: 'trust', timeout: TEN_MINUTES };

export const PLAIN_CHILD: Condition = { id: 'plain-child', label: 'Plain child', asksFrom: 'trust', timeout: TEN_MINUTES };

export const OUTSIDE_SUBTREE: Condition = {
  id: 'outside-subtree',
  label: 'Outside your subtree',
  asksFrom: 'review',
  timeout: TEN_MINUTES,
};
