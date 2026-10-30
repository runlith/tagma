import type { Raised } from '@runlith/agent/permissions';
import { Schema } from 'effect';
import { threadAgentSubject } from '@runlith/agent/permissions/threadSubject';
import { signerPrincipal, type Actor } from '../../../platform/contract/wire/actor.js';
import { arms, operation } from '../../../platform/contract/wire/operation.js';
import { harnessTransportSchema } from '../../../threads/contract/wire/harness/names.js';
import { placeRole } from '../../../platform/contract/wire/place.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../platform/contract/wire/conditions.js';
import { OUTSIDE_SUBTREE } from '../../../platform/contract/wire/conditions.js';
import { PROTOCOL_STATE } from './protocolState.js';

const subject = (kind: 'read' | 'write', threadId: string, actor: Actor) => [
  {
    kind,
    value: threadAgentSubject(actor.kind === 'operator' ? 'operator' : signerPrincipal(actor), threadId),
  },
];

const threadId = Schema.String.check(Schema.isMinLength(1)).annotate({
  ...placeRole('thread'),
  description: 'The harness thread.',
});

const BOOKKEEPING =
  "Name the thread, never an execution id, an incarnation, a lane or a sequence number. Those are the server's own bookkeeping; the facet already holds the process.";

const DOORS = { http: true } as const;

const harnessAct = {
  doors: DOORS,
  tool: { capability: 'threads' },
  callers: 'any',
  place: 'project',
  graph: 'none',
  subject: 'none',
  waits: [],
  lifetimes: [],
} as const;

export const HARNESS_OPERATIONS = {
  speak_harness: operation('speak_harness', {
    approval: ASKS_IN_REVIEW,
    ...harnessAct,
    effect: 'write',
    identity: { key: 'request' },
    answer: arms({ spoken: { threadId: Schema.String, runId: Schema.String, queued: Schema.Boolean } }),
    meaning: 'Speak words to the running CLI of a harness thread.',
    grammar: `${BOOKKEEPING}
The words reach the running CLI the way a person speaking to it would. They are words, not an answer to a standing ask — answering is answer_question.`,
    input: Schema.Struct({
      threadId,
      text: Schema.String.check(Schema.isMinLength(1)).annotate({
        description: 'The words to speak to the running CLI.',
      }),
    }),
    refusals: ['not-found', 'foreign-project', 'not-a-harness-thread', 'harness-missing'],
    subjects: (input, _prepared, actor) => subject('write', input.threadId, actor),
    confirmation: (input) => ({
      summary: `Speak to the CLI of ${input.threadId}?`,
      facts: [{ label: 'Words', value: input.text }],
    }),
    confirmLabel: 'Speak',
    presentation: {
      running: 'Speaking to a harness',
      done: 'Spoke to a harness',
    },
  }),

  read_harness_screen: operation('read_harness_screen', {
    approval: ASKS_NEVER,
    ...harnessAct,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: { screenText: Schema.String, threadId: Schema.String } }),
    meaning: "Read what a harness thread's CLI currently shows, as the visible rows of text, bounded.",
    grammar: `${BOOKKEEPING}
The answer is the visible rows as a reader sees them, not styled cells. The pane's styled-frame road is unchanged. This door bounds the text; you do not name a byte budget, a revision or a parsed-through offset.`,
    input: Schema.Struct({ threadId }),
    refusals: ['not-found', 'foreign-project', 'not-a-harness-thread', 'screen-unavailable'],
    confirmation: (input) => ({ summary: `Read the visible CLI screen of ${input.threadId}?` }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a harness screen',
      done: 'Read a harness screen',
      many: (count) => `Read ${count} harness screens`,
    },
    subjects: (input, _prepared, actor) => subject('read', input.threadId, actor),
  }),

  read_harness_protocol: operation('read_harness_protocol', {
    approval: ASKS_NEVER,
    ...harnessAct,
    effect: 'read',
    identity: 'none',
    answer: arms({ ok: PROTOCOL_STATE }),
    meaning:
      'Read where the protocol of a harness thread on acp stands: its session, runner, output read position and unanswered requests.',
    grammar: `${BOOKKEEPING}
Read it when a thread on acp stands still. A gap between \`stdout.parsed\` and \`stdout.written\` is runner output the driver has not taken; an old request in \`requests\` is one the agent has not answered; \`driverFailure\` names why the last driver of this server ended. The answer names the runner execution for the terminal reads.`,
    input: Schema.Struct({ threadId }),
    refusals: ['not-found', 'foreign-project', 'not-a-harness-thread', 'protocol-unavailable', 'session-unreadable'],
    confirmation: (input) => ({ summary: `Read the protocol state of ${input.threadId}?` }),
    confirmLabel: 'Read',
    presentation: {
      running: 'Reading a harness protocol',
      done: 'Read a harness protocol',
      many: (count) => `Read ${count} harness protocols`,
    },
    subjects: (input, _prepared, actor) => subject('read', input.threadId, actor),
  }),

  set_thread_transport: operation('set_thread_transport', {
    approval: { ...ASKS_IN_REVIEW, when: [OUTSIDE_SUBTREE] },
    doors: { http: true },
    tool: { capability: 'threads' },
    callers: 'any',
    place: 'project',
    graph: 'none',
    subject: 'none',
    waits: [],
    lifetimes: [],
    effect: 'write',
    identity: { key: 'request' },
    answer: arms({
      switched: { threadId: Schema.String, transport: harnessTransportSchema, unstarted: Schema.NullOr(Schema.String) },
      unchanged: { threadId: Schema.String, transport: harnessTransportSchema },
    }),
    meaning: 'Move a harness thread between its terminal CLI and its vendor protocol (acp) between turns.',
    grammar: `${BOOKKEEPING}
The operator or the thread's parent moves it. A process resting between turns is ended first; a turn still going refuses. A move to the terminal starts the CLI at once, idle at its prompt; \`unstarted\` names why it did not, and the next words start it. A move to acp starts its process with the next turn; where that protocol runs Tagma's agent, the thread becomes that agent on the model and rung it held or its CLI reported, else on the model's defaults. The start continues the same vendor session where the vendor shares sessions between both, else it opens a new one carrying the thread's recap. Words delivered without confirmation stay so.`,
    input: Schema.Struct({ threadId, transport: harnessTransportSchema }),
    refusals: [
      'not-found',
      'foreign-project',
      'not-a-harness-thread',
      'transport-unavailable',
      'profile-transport',
      'thread-running',
      'session-deleting',
      'harness-missing',
      'harness-not-installed',
      'journal-moved',
      'session-uncertain',
    ],
    subjects: (input, _consents: readonly Raised[] | undefined, actor) => subject('write', input.threadId, actor),
    raises: (_input, consents: readonly Raised[] | undefined) => consents ?? [],
    confirmation: (input) => ({ summary: `Move ${input.threadId} onto ${input.transport}?` }),
    confirmLabel: 'Move',
    presentation: {
      running: 'Moving a harness thread onto another transport',
      done: 'Moved a harness thread onto another transport',
    },
  }),
} as const;

export type HarnessOperationId = keyof typeof HARNESS_OPERATIONS;
export const HARNESS_OPERATION_IDS = Object.keys(HARNESS_OPERATIONS) as readonly HarnessOperationId[];
