import { AgentApprovalMode } from '@runlith/agent/contracts';
import { DEFAULT_READER } from '@runlith/agent/collaboration/askVerbs';
import { SUB_AGENT_DEPTH } from '@runlith/agent/collaboration/CollaborationConfig';
import { NO_REVIEW, ReviewPolicy, TeamEdit } from '@runlith/agent/collaboration/team';
import { COLD_WAKE_RULE } from '@runlith/agent/collaboration/wakeCost';
import { DEFAULT_MODE } from '@runlith/agent/modes/builtin';
import { APPROVES_ALL } from '@runlith/agent/thread/Approvers';
import { Schema } from 'effect';
import { AskChoice, SETTABLE_SCOPES, settingKey, settingListKey } from '../../../platform/contract/wire/setting.js';

export const subAgentDepth = settingKey({
  id: 'agent.subAgentDepth',
  order: 60,
  title: 'Sub-agent depth',
  description: 'Floors of delegation below the root agent; deeper delegation has no sensible shape.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: SUB_AGENT_DEPTH.minimum, maximum: SUB_AGENT_DEPTH.maximum })),
  control: {
    kind: 'slider',
    minimum: SUB_AGENT_DEPTH.minimum,
    maximum: SUB_AGENT_DEPTH.maximum,
    step: 1,
  },
  fallback: SUB_AGENT_DEPTH.default,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const delegation = settingKey({
  id: 'agent.delegation',
  order: 70,
  title: 'Delegation',
  description:
    "Whether agents may start other agents. A thread's own switch overrides this for that thread and the team it starts; off, spawn_agent refuses every agent the operator did not ask for, including when it copies history with fork, and a working agent is told at its next step.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: ['user'],
  merge: 'replace',
});

export const operatorNotice = settingKey({
  id: 'agent.operatorNotice',
  order: 75,
  title: 'Tell a parent when the operator writes to its child',
  description:
    "Whether a parent agent is sent a notice each time the operator's words reach one of its children directly. Off, the notice is neither sent nor kept for later; a parent that asked for it on a child through `set_thread_operator_notice` still receives it for that child.",
  schema: Schema.Boolean,
  fallback: false,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const approves = settingListKey({
  id: 'agent.approves',
  order: 76,
  title: 'What a parent answers for its children instead of you',
  description:
    'Which questions of its children a parent agent answers: `*` every one, approvals and ask_user alike; an action name every question of that action; a condition id that reason on any action. A question the list does not cover waits for you; empty, every question does. The parent’s answer is final.',
  member: Schema.String.check(Schema.isMinLength(1)),
  fallback: [APPROVES_ALL] as readonly string[],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
  operatorOnly: true,
});

export const takeover = settingKey({
  id: 'agent.takeover',
  order: 77,
  title: 'Writing to a sub-agent makes you its approver',
  description:
    "Whether the operator's words to a sub-agent move its questions to the operator. On, a question the thread asks goes to you from then on, until `/approver default` hands it back to its parent; off, its parent keeps answering.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const birthApprovalMode = settingKey({
  id: 'agent.approvalMode',
  order: 80,
  title: 'What a new thread asks before it acts',
  description:
    'The approval mode a thread of this project is born with. A mode is a strictness rung: each act declares the rung it asks from, and the mode asks wherever its rung reaches. Bypass asks about nothing; a system limit still refuses a call.',
  schema: AgentApprovalMode,
  fallback: DEFAULT_MODE,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

const OFFERED_AUDIENCES = ['operator', 'agents'] as const;
export type OfferAudience = (typeof OFFERED_AUDIENCES)[number];

const OfferEntry = Schema.Struct({
  type: Schema.String.check(Schema.isMinLength(1)),
  to: Schema.Literals(OFFERED_AUDIENCES),
});
type OfferEntry = typeof OfferEntry.Type;

export const agentsOffered = settingListKey({
  id: 'agent.offered',
  order: 90,
  title: 'Who is offered a type',
  description:
    'Each entry names a type — an agent in code or one declared in a file — and who may start it: `operator` for the operator alone, `agents` for agents too, as in `{"type": "reviewer", "to": "agents"}`. Absent, an agent in code and a file of your personal agents are offered to agents, and a file of a project or a plugin to you alone. A later entry wins, so a project answers over the standing one.',
  member: OfferEntry,
  fallback: [] as readonly OfferEntry[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const teamModels = settingListKey({
  id: 'agent.models',
  order: 91,
  title: 'Models sub-agents run on',
  description:
    'Edits over the rows the providers ship, applied in order, a project’s after the machine’s; a thread with a copy of its own (set_thread_team) follows that copy instead. `{provider, model, reasoning}` names a row — a model on one rung — and sets any of `open`, `depth`, `taste`, `ui`, `spend` (1–10), `favor` (−5…5, the operator’s wish to see the row taken more or less often, shown to agents beside spend), `only`/`not` (kinds of work), `note` (up to six English words), `operatorOnly`, `on` (agents may start a child on it) and `reviews` (agents may start a reviewer on it); `removed: true` drops it; a row no ship holds starts from middle ratings, and an edit setting only `reviews` marks a standing row and adds none. `{provider, on}` switches every row of that provider off or back on, each keeping its own `on` and `reviews`. A field no edit sets follows the shipped value; a shipped row starts with `on` and `reviews` off until an edit sets them, a row an edit adds starts on. Rows show only while one of their provider’s accounts is connected, and those that work or review stand in the description of `spawn_agent.model`.',
  member: TeamEdit,
  fallback: [] as readonly TeamEdit[],
  scopes: SETTABLE_SCOPES,
  merge: 'concat',
});

export const teamReview = settingKey({
  id: 'agent.review',
  order: 92,
  title: 'Review of sub-agents’ work',
  description:
    '`reviewers`: 0 for no review, 1 for one, more for a ceiling the agent stays under. Each reviewer runs on a row of `agent.models` marked `reviews`, chosen for the work by its ratings as a child’s model is; no row marked means no review. `lenses`: none, and every reviewer reads the whole work; some, and the first reads the whole and each next one a lens.',
  schema: ReviewPolicy,
  fallback: NO_REVIEW,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const DEFAULT_THREAD_TYPE = 'tagma';

export const defaultType = settingKey({
  id: 'agent.default',
  order: 95,
  title: 'The agent a new thread opens as',
  description:
    'The type a thread of this project is born as when its opener names none — an agent in code or one declared in a file, offered as `agent.offered` decides.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  fallback: DEFAULT_THREAD_TYPE,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const askAgent = settingKey({
  id: 'agent.ask',
  order: 97,
  title: 'The reader that answers ask',
  description:
    'The agent definition `ask` starts, one per question, when the call names none — one declared in a file or the built-in reader, offered as `agent.offered` decides. It answers with `answer`, whatever tools its definition lists.',
  schema: Schema.String.check(Schema.isMinLength(1)),
  fallback: DEFAULT_READER,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const AGENT_WEBS = ['vendor', 'tagma'] as const;
export type AgentWeb = (typeof AGENT_WEBS)[number];

export const agentWeb = settingKey({
  id: 'agent.web',
  order: 96,
  title: 'Where a thread searches and reads the web',
  description:
    'Whether a thread on a model whose provider gives it a web of its own searches and reads with that web, or with the search and fetch Tagma ships. The choice takes effect when a run opens. A model with no web of its own, and a terminal Claude Code, always use what they have.',
  schema: Schema.Literals(AGENT_WEBS),
  control: {
    kind: 'choice',
    choices: [
      { value: 'vendor', label: 'The provider’s', hint: 'Search and read as the provider’s own client does, on the subscription.' },
      { value: 'tagma', label: 'Tagma’s', hint: 'Search and read with the web tools Tagma ships.' },
    ],
  },
  fallback: 'vendor' as AgentWeb,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const autoTitle = settingKey({
  id: 'threads.autoTitle',
  order: 100,
  title: 'Name threads automatically',
  description:
    'Ask the model, once per message the reader sends, to name a thread still wearing the random name it was born with. A thread named by hand, or already named this way, is never asked about again.',
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const recap = settingKey({
  id: 'threads.recap',
  order: 140,
  title: 'Write recaps automatically',
  description:
    "After a run of a thread the reader spoke in, ask the thread's own model on its warm cache for a short recap of where the thread stands. Off, nothing is written on its own; recaps already written stay in view, and /recap writes one on request.",
  schema: Schema.Boolean,
  fallback: true,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const coldWakeRefusal = settingKey({
  id: 'threads.coldWakeRefusal',
  order: 145,
  title: 'Refuse to wake a cold, large sub-agent',
  description:
    "Whether a message or task an agent sends its idle descendant is refused when that descendant's prompt cache has surely expired and its context holds at least the threshold below; the agent may send again with `wake: true`. Off, the send wakes it and the delivery names what it rewrote.",
  schema: Schema.Boolean,
  fallback: COLD_WAKE_RULE.refuse,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const coldWakeTokens = settingKey({
  id: 'threads.coldWakeTokens',
  order: 146,
  title: 'Context a cold wake is refused from',
  description: 'The context size, in tokens, at which waking a sub-agent whose cache has surely expired is refused.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  control: { kind: 'number', minimum: 0, step: 10_000, unit: 'tokens' },
  fallback: COLD_WAKE_RULE.tokens,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const titleModel = settingKey({
  id: 'threads.titleModel',
  order: 110,
  title: 'Fresh naming model',
  description:
    "`{provider, model, reasoning}` for compact naming when a captured request is unavailable or its completed answer was rejected; it must answer text asks and offer the rung, a null rung taking the model's default. Null: the light model of the thread's provider, then the thread's own model at its lowest rung, then your default model's, then the first connected provider's light model.",
  schema: Schema.NullOr(AskChoice),
  control: { kind: 'ask', of: 'text' },
  fallback: null as AskChoice | null,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const TITLE_CHARACTERS_MAX = 16_384;

export const titleCharacters = settingKey({
  id: 'threads.titleCharacters',
  order: 130,
  title: 'Fresh naming text budget',
  description: 'Maximum reader-text characters sent for a fresh title; opening and recent words share the budget.',
  schema: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: TITLE_CHARACTERS_MAX })),
  control: { kind: 'number', minimum: 1, maximum: TITLE_CHARACTERS_MAX, step: 1, unit: 'characters' },
  fallback: 8192,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const decisionModel = settingKey({
  id: 'threads.decisionModel',
  order: 135,
  title: 'Decision model',
  description:
    "`{provider, model, reasoning}` that answers the server's typed questions about a thread; it must answer decisions and offer the rung, a null rung taking the model's default. Null: the first connected model built for decisions, else the light model of the thread's provider, else the thread's own model on its lowest rung, else your default model's, else the first connected provider's light model. A named model always answers; one that cannot answer refuses.",
  schema: Schema.NullOr(AskChoice),
  control: { kind: 'ask', of: 'decision' },
  fallback: null as AskChoice | null,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const AGENT_WORKTREES = ['ask', 'allow'] as const;

export const agentWorktrees = settingKey({
  id: 'agent.worktrees',
  order: 150,
  title: 'Agents making worktrees',
  description:
    'Whether trust asks before an agent cuts a new worktree for its child; review always asks, bypass never does. Placing a child in a worktree that already stands is never gated here.',
  schema: Schema.Literals(AGENT_WORKTREES),
  control: {
    kind: 'choice',
    choices: [
      { value: 'ask', label: 'Ask', hint: 'Each new worktree an agent asks for waits for your approval.' },
      { value: 'allow', label: 'Allow', hint: 'Agents make worktrees for their children without asking.' },
    ],
  },
  fallback: 'allow' as (typeof AGENT_WORKTREES)[number],
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const idleProjectionDays = settingKey({
  id: 'threads.idleProjectionDays',
  order: 560,
  title: 'Evict an idle thread after',
  description:
    'Days a thread rests without durable movement before its records leave the database for its rollout file; the first door that opens it reads them back. Zero evicts nothing.',
  schema: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  control: { kind: 'number', minimum: 0, step: 1, unit: 'days' },
  fallback: 7,
  scopes: SETTABLE_SCOPES,
  merge: 'replace',
});

export const THREADS_SETTING_KEYS = [
  subAgentDepth,
  delegation,
  operatorNotice,
  approves,
  takeover,
  birthApprovalMode,
  agentsOffered,
  teamModels,
  teamReview,
  defaultType,
  askAgent,
  agentWeb,
  autoTitle,
  titleModel,
  titleCharacters,
  decisionModel,
  recap,
  coldWakeRefusal,
  coldWakeTokens,
  agentWorktrees,
  idleProjectionDays,
] as const;

export const THREADS_SETTING_SECTIONS = [
  {
    id: 'threads',
    order: 70,
    title: 'Threads',
    description:
      'How a thread of this project is named and recapped, which model answers decisions about it, when an agent may wake a cold sub-agent, and how long a thread rests idle before its records leave the database.',
  },
] as const;
