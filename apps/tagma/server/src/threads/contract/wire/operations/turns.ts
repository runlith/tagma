import { Schema } from 'effect';
import { threadInput } from '../project.js';
import {
  threadAuthoritySchema,
  threadQuestionAnswerSchema,
  threadSaidResultSchema,
  threadSendSchema,
  threadSteerSchema,
  threadStopResultSchema,
  threadStopSchema,
  threadTurnResultSchema,
  threadUnqueueSchema,
} from '@runlith/agent/protocol/realtime';
import { placedCursor, placeRole } from '../../../../platform/contract/wire/place.js';
import { threadQueuedTurnSchema } from '@runlith/agent/protocol/http';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';
import {
  REWIND_FILES,
  rewindActsSchema,
  rewindDraftSchema,
  rewindDraftsSchema,
  rewindFilesSchema,
  rewindPointsFields,
  rewindPreviewSchema,
  rewindRevertedSchema,
  rewindScopeSchema,
} from '../rewind.js';
import { threadWireSnapshotPayloadSchema } from '../snapshot.js';
import { ENDINGS, ENDING_DEPTH, endingRowSchema } from '../endings.js';
import { statusRowSchema, STATUSES } from '../statuses.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const [sentStarted, sentSteered, sentQueued] = threadSaidResultSchema.members;
const SAID_ARMS = {
  started: { runId: sentStarted.fields.runId, acted: sentStarted.fields.acted },
  steered: { runId: sentSteered.fields.runId, itemId: sentSteered.fields.itemId, acted: sentSteered.fields.acted },
  queued: { runId: sentQueued.fields.runId, queued: sentQueued.fields.queued, acted: sentQueued.fields.acted },
};
const [stopStopped, stopRequested, , stopMismatch] = threadStopResultSchema.members;
const [turnStarted, turnAlreadyRunning] = threadTurnResultSchema.members;

const TURN_REFUSALS = [
  'unknown-project',
  'not-found',
  'foreign-project',
  'thread-gone',
  'run-active',
  'interaction-conflict',
  'not-a-harness-thread',
  'harness-missing',
  'harness-not-installed',
  'cli-background',
  'answer-invalid',
  'withdraw-failed',
  'transport-cannot',
] as const;

export const ENDING_REFUSALS = [
  'thread-commands-standing',
  'thread-execution-standing',
  'thread-executions-unreadable',
  'thread-tasks-unreadable',
  'harness-missing',
  'session-uncertain',
  'session-deleting',
  'session-elsewhere',
  'session-owned',
  'session-unreadable',
  'cli-standing',
  'cli-background',
  'transport-cannot',
] as const;

const THREAD_GATE = ['unknown-project', 'not-found', 'foreign-project', 'thread-gone'] as const;

const REWIND_BLOCKED = ['rewind-summarized', 'rewind-rewound', 'rewind-unknown'] as const;

const KEY_REFUSALS = ['key-reused', 'act-spent', 'sequence-unavailable'] as const;

const socketRead = {
  doors: { socket: true, http: true },
  tool: undefined,
  callers: 'operator',
  place: 'project',
  subject: 'none',
  waits: [],
  lifetimes: [],
  effect: 'read',
  identity: 'none',
  subjects: () => [],
} as const;

const socketAct = {
  doors: { socket: true, http: false },
  tool: undefined,
  callers: 'operator',
  place: 'project',
  subject: 'none',
  waits: [],
  lifetimes: [],
  effect: 'write',
  identity: { key: 'call' },
  subjects: () => [],
} as const;

const operatorAct = { ...socketAct, doors: { socket: true, http: true }, tool: undefined } as const;

export const TURN_OPERATIONS = {
  start_turn: operation('start_turn', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    external: true,
    meaning: 'Start a turn on a thread from a message: a run opens over it, or the message joins the run that is going.',
    input: Schema.Struct({ threadId: ThreadId, ...threadSendSchema.fields }),
    answer: arms(SAID_ARMS),
    refusals: [...TURN_REFUSALS, ...KEY_REFUSALS],
    confirmation: (input) => ({ summary: `Send a message to ${input.threadId}?` }),
    confirmLabel: 'Send',
    presentation: { running: 'Sending a message', done: 'Sent a message' },
  }),
  queue_turn: operation('queue_turn', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    external: true,
    meaning: 'Queue a message for the next turn of a thread, behind the run that is going.',
    input: Schema.Struct({ threadId: ThreadId, ...threadSendSchema.fields }),
    answer: arms(SAID_ARMS),
    refusals: [...TURN_REFUSALS, ...KEY_REFUSALS],
    confirmation: (input) => ({ summary: `Queue a message for ${input.threadId}?` }),
    confirmLabel: 'Queue',
    presentation: { running: 'Queueing a message', done: 'Queued a message' },
  }),
  steer_turn: operation('steer_turn', {
    approval: ASKS_IN_REVIEW,
    ...socketAct,
    graph: 'none',
    meaning:
      'Steer the run that is going on a thread with a message it reads at its next step. The message is kept first: when `expectedRunId` is not the run going, or that run reads no words mid-run, it waits for the turn after it (`queued`); with no run going, a run opens over it (`started`).',
    input: Schema.Struct({ threadId: ThreadId, ...threadSteerSchema.fields }),
    answer: arms(SAID_ARMS),
    refusals: [...TURN_REFUSALS, ...KEY_REFUSALS],
    confirmation: (input) => ({ summary: `Steer the run on ${input.threadId}?` }),
    confirmLabel: 'Steer',
    presentation: { running: 'Steering a run', done: 'Steered a run' },
  }),
  unqueue_turn: operation('unqueue_turn', {
    approval: ASKS_IN_REVIEW,
    ...socketAct,
    graph: 'none',
    meaning: 'Take back a queued turn, an unread steer or a compaction request before a run takes it.',
    input: Schema.Struct({ threadId: ThreadId, ...threadUnqueueSchema.fields }),
    answer: arms({ unqueued: {}, 'not-queued': {} }),
    refusals: TURN_REFUSALS,
    confirmation: (input) => ({ summary: `Take back the queued input on ${input.threadId}?` }),
    confirmLabel: 'Take back',
    presentation: { running: 'Taking back queued input', done: 'Took back queued input' },
  }),
  answer_question: operation('answer_question', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    external: 'own',
    meaning: "Answer the question a thread's run is waiting on; a run opens over the answer.",
    input: Schema.Struct({ threadId: ThreadId, ...threadQuestionAnswerSchema.fields }),
    answer: arms({
      started: { runId: turnStarted.fields.runId },
      'already-running': { runId: turnAlreadyRunning.fields.runId },
    }),
    refusals: [...TURN_REFUSALS, ...KEY_REFUSALS],
    confirmation: (input) => ({ summary: `Answer the question on ${input.threadId}?` }),
    confirmLabel: 'Answer',
    presentation: { running: 'Answering a question', done: 'Answered a question' },
  }),
  set_thread_authority: operation('set_thread_authority', {
    approval: ASKS_IN_REVIEW,
    ...socketAct,
    graph: 'none',
    meaning: "Set how a thread's runs are approved: the mode its next tool calls are judged under.",
    input: Schema.Struct({ threadId: ThreadId, ...threadAuthoritySchema.fields }),
    answer: arms({ loaded: { snapshot: threadWireSnapshotPayloadSchema.fields.snapshot } }),
    refusals: [...TURN_REFUSALS, 'mode-unknown'],
    confirmation: (input) => ({ summary: `Set the approval mode of ${input.threadId} to ${input.mode}?` }),
    confirmLabel: 'Set mode',
    presentation: { running: 'Setting an approval mode', done: 'Set an approval mode' },
  }),
  stop_run: operation('stop_run', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    external: 'own',
    meaning:
      'Stop the run going on a thread, or withdraw the turn it took when the thread can. `runId` names the run the caller expects: another run going answers `run-mismatch` with it. A run another server process owns answers `requested`: that owner stops it.',
    input: Schema.Struct({ threadId: ThreadId, ...threadStopSchema.fields }),
    answer: arms({
      stopped: { runId: stopStopped.fields.runId },
      requested: { runId: stopRequested.fields.runId },
      'nothing-running': {},
      'run-mismatch': { runId: stopMismatch.fields.runId },
    }),
    refusals: [...TURN_REFUSALS, ...ENDING_REFUSALS.filter((code) => !(TURN_REFUSALS as readonly string[]).includes(code))],
    confirmation: (input) => ({ summary: `Stop the run on ${input.threadId}?` }),
    confirmLabel: 'Stop',
    presentation: { running: 'Stopping a run', done: 'Stopped a run' },
  }),
  rewind_thread: operation('rewind_thread', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    waits: ['entry-gate'],
    lifetimes: ['workspace'],
    meaning:
      "Take a turn out of a thread's history: `from` this turn and every turn after it, or `turn` this one alone. A run that is going is stopped first; queued turns and unread steers come back in the answer with the message's text, so nothing starts on its own. The entries stay readable, marked rewound, until restore_thread.",
    input: Schema.Struct({
      threadId: ThreadId,
      at: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The run whose turn is taken out.' }),
      scope: rewindScopeSchema,
      revertLines: Schema.optional(Schema.Boolean).annotate({
        description:
          "After the rewind lands, take back the lines the thread's own uncommitted changes wrote in the rewound turns, each line returning to the mark it carried before; a line another session wrote over since, or one already committed, stays.",
      }),
      key: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 128))).annotate({
        description: 'Names this act: asking again under it answers what the first ask did.',
      }),
    }),
    answer: arms({
      rewound: {
        rewindId: Schema.String,
        scope: rewindScopeSchema,
        runIds: Schema.Array(Schema.String),
        draft: Schema.NullOr(rewindDraftSchema),
        taken: Schema.Array(threadQueuedTurnSchema),
        drafts: rewindDraftsSchema,
        stopped: Schema.NullOr(Schema.String),
        reverted: Schema.optional(rewindRevertedSchema),
      },
    }),
    refusals: [
      ...THREAD_GATE,
      'harness-contract',
      'transport-cannot',
      'session-rewind-failed',
      'session-uncertain',
      ...REWIND_BLOCKED,
      ...KEY_REFUSALS,
    ],
    confirmation: (input) => ({
      summary: `Take ${input.scope === 'from' ? 'this turn and every turn after it' : 'this turn'} out of ${input.threadId}?`,
    }),
    confirmLabel: 'Rewind',
    presentation: { running: 'Rewinding a thread', done: 'Rewound a thread' },
  }),
  restore_thread: operation('restore_thread', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    meaning: 'Put back the turns a rewind took out, while no turn has run and no compaction has settled since.',
    input: Schema.Struct({
      threadId: ThreadId,
      rewindId: Schema.String.check(Schema.isMinLength(1)),
      key: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 128))),
    }),
    answer: arms({ restored: { rewindId: Schema.String, runIds: Schema.Array(Schema.String) } }),
    refusals: [
      ...THREAD_GATE,
      'harness-contract',
      'transport-cannot',
      'run-active',
      'restore-superseded',
      'restore-unknown',
      ...KEY_REFUSALS,
    ],
    confirmation: (input) => ({ summary: `Restore the turns rewind ${input.rewindId} took out of ${input.threadId}?` }),
    confirmLabel: 'Restore',
    presentation: { running: 'Restoring a rewind', done: 'Restored a rewind' },
  }),
  read_rewind: operation('read_rewind', {
    approval: ASKS_NEVER,
    ...socketRead,
    graph: 'none',
    lifetimes: ['workspace'],
    meaning:
      'What a rewind of one turn would take out and cannot take back: the turns, the words it returns to the composer, queued input it takes back, live child threads, the prompt tokens the next request rewrites, the files the thread changed in those turns and the graph writes it made.',
    grammar:
      'A file list that could not be read answers `files.unavailable` with the reason and no rows: that is "cannot tell", never "no files". `graph.bounded` says the journal read stopped before the earliest turn.',
    input: Schema.Struct({
      threadId: ThreadId,
      at: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The run whose turn would be taken out.' }),
      scope: rewindScopeSchema,
      limit: limitOf(REWIND_FILES),
      cursor: placedCursor,
    }),
    answer: arms({
      preview: { preview: rewindPreviewSchema, drafts: rewindDraftsSchema, files: rewindFilesSchema, graph: rewindActsSchema },
    }),
    refusals: [...THREAD_GATE, 'harness-contract', 'transport-cannot', ...REWIND_BLOCKED],
    confirmation: (input) => ({ summary: `Read what rewinding ${input.threadId} would take out?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading what a rewind takes out', done: 'Read what a rewind takes out' },
  }),
  read_rewind_points: operation('read_rewind_points', {
    approval: ASKS_NEVER,
    ...socketRead,
    graph: 'none',
    meaning:
      'Which turns of a thread a rewind can still take out and why not for the rest, and every rewind that stands with whether it can still be restored — one reading of the whole thread.',
    input: Schema.Struct({ threadId: ThreadId }),
    answer: arms({ points: rewindPointsFields }),
    refusals: [...THREAD_GATE, 'harness-contract', 'transport-cannot'],
    confirmation: (input) => ({ summary: `Read the rewind points of ${input.threadId}?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading rewind points', done: 'Read rewind points' },
  }),
  branch_thread: operation('branch_thread', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    meaning:
      "Start a new thread carrying this one's history — all of it, or ending right before a turn; the source thread is untouched. Cut before a turn, the answer carries that turn's words for the new thread's composer.",
    input: Schema.Struct({
      threadId: ThreadId,
      before: Schema.optional(
        Schema.String.check(Schema.isMinLength(1)).annotate({
          description: 'The run whose turn the new thread does not hold; omitted, the new thread holds the whole history.',
        }),
      ),
      key: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 128))),
    }),
    answer: arms({ branched: { threadId: Schema.String, draft: Schema.NullOr(rewindDraftSchema) } }),
    refusals: [
      ...THREAD_GATE,
      'harness-contract',
      'transport-cannot',
      'interaction-conflict',
      'run-active',
      ...REWIND_BLOCKED,
      ...KEY_REFUSALS,
    ],
    confirmation: (input) => ({
      summary: input.before === undefined ? `Fork ${input.threadId}?` : `Branch ${input.threadId} before a turn?`,
    }),
    confirmLabel: 'Branch',
    presentation: { running: 'Branching a thread', done: 'Branched a thread' },
  }),
  read_statuses: operation('read_statuses', {
    approval: ASKS_NEVER,
    ...socketRead,
    graph: 'none',
    external: true,
    meaning:
      'Read what the named threads of this project are doing now: for each, whether a run goes, is parked on an answer, stalled or idle, who holds it, the questions it waits on and the receipts of the inputs still waiting for it.',
    grammar:
      'One row per named thread, in the order named, with its `threadId`. A thread that does not exist answers `not-found` and one of another project `foreign-project` in its own row; the page itself never refuses for them. `total` is the number of threads named; `cursor` continues the walk over the same named set, and a changed set refuses `cursor-stale`. Only the rows of the page are read.',
    input: Schema.Struct({
      threads: Schema.Array(ThreadId)
        .check(Schema.isMinLength(1))
        .annotate({ description: 'The threads to read, in the order to answer them.' }),
      cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        ...placeRole('cursor'),
        description: 'The `cursor` the previous page answered; a changed set of threads refuses `cursor-stale`.',
      }),
      limit: limitOf(STATUSES),
    }),
    answer: arms({ ok: { rows: Schema.Array(statusRowSchema), total: Schema.Int, cursor: Schema.NullOr(Schema.String) } }),
    refusals: ['unknown-project', 'cursor-stale', 'bad-cursor'],
    confirmation: (input) => ({ summary: `Read the status of ${input.threads.length} threads?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading thread statuses', done: 'Read thread statuses' },
  }),
  read_endings: operation('read_endings', {
    approval: ASKS_NEVER,
    ...socketRead,
    graph: 'none',
    external: true,
    meaning:
      'Read how the latest runs of the named threads of this project ended: for each thread, its newest endings with their status, who stopped them, the failure and the state of the notification each owes.',
    grammar: `One row per named thread, in the order named, with its \`threadId\`. A thread that does not exist answers \`not-found\` and one of another project \`foreign-project\` in its own row; the page itself never refuses for them. \`depth\` is how many endings a row carries, newest first (default 1, at most ${ENDING_DEPTH}); a thread whose runs have not ended carries none. \`total\` is the number of threads named; \`cursor\` continues the walk over the same named set, and a changed set refuses \`cursor-stale\`. Only the rows of the page are read. A notification state \`notification-exhausted\` gave up and waits for an explicit re-take.`,
    input: Schema.Struct({
      threads: Schema.Array(ThreadId)
        .check(Schema.isMinLength(1))
        .annotate({ description: 'The threads whose endings to read, in the order to answer them.' }),
      depth: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: ENDING_DEPTH }))).annotate({
        description: `How many endings each row carries, newest first (default 1, at most ${ENDING_DEPTH}).`,
      }),
      cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1))).annotate({
        ...placeRole('cursor'),
        description: 'The `cursor` the previous page answered; a changed set of threads refuses `cursor-stale`.',
      }),
      limit: limitOf(ENDINGS),
    }),
    answer: arms({ ok: { rows: Schema.Array(endingRowSchema), total: Schema.Int, cursor: Schema.NullOr(Schema.String) } }),
    refusals: ['unknown-project', 'cursor-stale', 'bad-cursor'],
    confirmation: (input) => ({ summary: `Read the endings of ${input.threads.length} threads?` }),
    confirmLabel: 'Read',
    presentation: { running: 'Reading run endings', done: 'Read run endings' },
  }),
  redeliver_ending: operation('redeliver_ending', {
    approval: ASKS_IN_REVIEW,
    ...operatorAct,
    graph: 'none',
    meaning:
      'Deliver again the settlement of a run whose notification gave up (`notification-exhausted` in read_endings): its attempts start over and the subscribers it has not reached are called on the next settlement pass.',
    input: Schema.Struct({
      threadId: ThreadId,
      runId: Schema.String.check(Schema.isMinLength(1)).annotate({ description: 'The ended run whose settlement to deliver again.' }),
    }),
    answer: arms({ redelivering: {}, 'not-exhausted': {}, 'run-not-found': {} }),
    refusals: THREAD_GATE,
    confirmation: (input) => ({ summary: `Deliver the ending of run ${input.runId} again?` }),
    confirmLabel: 'Redeliver',
    presentation: { running: 'Redelivering a run ending', done: 'Redelivered a run ending' },
  }),
};

export type TurnOperationId = keyof typeof TURN_OPERATIONS;
