import { Schema } from 'effect';
import { touchBriefSchema } from '../../../graph/contract/wire/operations/orientation.js';
import { Place } from '../../../platform/contract/wire/place.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { harnessReceiptSchema, harnessReportSchema } from '../../../threads/contract/wire/harness/observation.js';
import { harnessAdoptedSchema, harnessAdoptSchema } from './adoption.js';
import { harnessCallAnswerSchema, harnessDecisionSchema } from './call.js';
import { harnessCallSchema } from '@runlith/tagma/adapter/harness';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';

const nobody = () => [];

const hookDoor = {
  doors: { http: 'perform' },
  tool: undefined,
  callers: 'thread',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
  subjects: nobody,
  confirmLabel: 'Deliver',
} as const;

const PROVEN =
  'The thread is the one this call proves from its signed grant; a call no door proved refuses `session-unproven`. A hook names no thread.';

const HOOK_REFUSALS = [
  'session-unproven',
  'not-found',
  'not-a-harness-thread',
  'harness-missing',
  'harness-not-installed',
  'harness-contract',
  'session-unreadable',
  'session-deleting',
  'session-owned',
  'session-uncertain',
  'observation-time',
  'answer-invalid',
  'interaction-conflict',
  'typing-unavailable',
  'foreign-project',
  'thread-gone',
  'execution-gone',
  'stale-execution',
  'storage-changed',
  'cli-background',
  'cli-standing',
  'not-interactive',
  'ask-standing',
  'harness-lane-unopened',
] as const;

export const HOOK_OPERATIONS = {
  report_harness_event: operation('report_harness_event', {
    approval: ASKS_IN_REVIEW,
    ...hookDoor,
    meaning:
      "Deliver one observation a foreign CLI's hook made of its own session: a turn starting, a tool call, the words a turn ended with. A shell call reported with its command and directory is measured as a command of the thread from this report to the one that settles the call.",
    grammar: PROVEN,
    input: harnessReportSchema,
    answer: arms({ reported: harnessReceiptSchema.fields }),
    refusals: HOOK_REFUSALS,
    effect: 'write',
    identity: { key: 'request' },
    confirmation: () => ({ summary: 'Deliver a hook observation?' }),
    presentation: { running: 'Delivering a hook observation', done: 'Delivered a hook observation' },
  }),

  judge_harness_call: operation('judge_harness_call', {
    approval: ASKS_IN_REVIEW,
    ...hookDoor,
    meaning: "Judge one tool call a foreign CLI is about to make against the thread's permission mode.",
    grammar: PROVEN,
    input: harnessCallSchema,
    answer: arms({ judged: { decision: harnessDecisionSchema } }),
    refusals: HOOK_REFUSALS,
    effect: 'write',
    identity: { key: 'request' },
    confirmation: (input) => ({ summary: `Judge the ${input.tool} call?` }),
    presentation: { running: 'Judging a tool call', done: 'Judged a tool call' },
  }),

  record_harness_outcome: operation('record_harness_outcome', {
    approval: ASKS_NEVER,
    ...hookDoor,
    meaning: 'Wait a bounded time for the operator to answer a permission ask a foreign CLI raised.',
    grammar: `${PROVEN}\nAnswers \`Waiting\` when the ask is still standing at the bound; ask again.`,
    input: Schema.Struct({ requestId: Schema.String }),
    answer: arms({ outcome: { answer: harnessCallAnswerSchema } }),
    refusals: HOOK_REFUSALS,
    effect: 'read',
    identity: 'none',
    deadline: 'wait-input',
    confirmation: () => ({ summary: 'Wait for the permission answer?' }),
    presentation: { running: 'Waiting for a permission answer', done: 'Waited for a permission answer' },
  }),

  guide_harness: operation('guide_harness', {
    approval: ASKS_NEVER,
    ...hookDoor,
    meaning:
      'Ask what guidance still stands to be told to a foreign CLI: the operator notes beside the words of a prompt, the law of the places a tool call touched, or the conversation a fresh session of the thread starts from. The server keeps what was already told to the thread.',
    grammar: `${PROVEN}\nA prompt answers the operator notes standing for the words it names. Touch briefs answer the text of what is new to the thread, or null. The evidence names one hook invocation: asking again with it answers the text the first ask recorded. A seed answers, once per session, the newest turns of the thread's record that fit in \`room\` characters and names how many earlier turns it left out, or null when the session started on its own conversation.`,
    input: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal('prompt'),
        evidence: Schema.String,
        inputs: Schema.Array(Schema.String),
      }),
      Schema.Struct({
        kind: Schema.Literal('touch'),
        evidence: Schema.String,
        briefs: Schema.Array(touchBriefSchema),
        places: Schema.Array(Place),
      }),
      Schema.Struct({
        kind: Schema.Literal('seed'),
        room: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      }),
    ]),
    answer: arms({ guided: { text: Schema.NullOr(Schema.String) } }),
    refusals: HOOK_REFUSALS,
    effect: 'write',
    identity: { key: 'request' },
    confirmation: () => ({ summary: 'Ask what guidance stands?' }),
    presentation: { running: 'Asking what guidance stands', done: 'Asked what guidance stands' },
  }),

  adopt_harness_session: operation('adopt_harness_session', {
    approval: ASKS_IN_REVIEW,
    ...hookDoor,
    callers: 'any',
    meaning: 'Adopt a foreign CLI already running in a shell of this machine as a thread of the project its cwd names.',
    grammar:
      'Proves the shell and the CLI beneath it from the ancestry the hook read; a shell this server does not know, a CLI not under it, or a CLI without hooks refuses. Answers the thread and the grant the CLI carries afterwards.',
    input: harnessAdoptSchema,
    answer: arms({ adopted: harnessAdoptedSchema.fields }),
    refusals: [...HOOK_REFUSALS, 'shell-unknown', 'not-under-shell', 'harness-unhooked', 'job-unproven', 'mode-unknown'],
    effect: 'write',
    identity: { key: 'request' },
    confirmation: () => ({ summary: 'Adopt the running CLI?' }),
    presentation: { running: 'Adopting a running CLI', done: 'Adopted a running CLI' },
  }),
} as const;

export type HookOperationId = keyof typeof HOOK_OPERATIONS;
