import { Schema } from 'effect';
import { PAGE_CURSOR, PageCursor, pageRows } from '@runlith/paging';
import { CallControl, CallControlResult, CallRecord, LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import type { ClaimTarget } from '@runlith/agent/tool';
import { ceilingOf, limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { arms, operation } from '../../../../platform/contract/wire/operation.js';
import { CALLS } from '../pages.js';
import { ASKS_IN_REVIEW, ASKS_NEVER } from '../../../../platform/contract/wire/conditions.js';

const runId = Schema.NonEmptyString.annotate({
  description: 'The run id the invocation belongs to, exactly as a reading of the calls printed it.',
});

const toolCallId = Schema.NonEmptyString.annotate({
  description:
    'The tool call id within that run, exactly as a reading of the calls printed it. The pair addresses one invocation and nothing else.',
});

const CONTROL_MECHANICS = `THREE CONTROLS, and none of them touches the run. \`stop\` ends THIS invocation and what it owns, and the run continues: the model receives the stopping as its own call's outcome and may answer or call again. \`background\` releases the model's wait without restarting and without cancelling the work — the invocation goes on, owned by its thread rather than its run, its ending stays observable and its result reaches the thread it belongs to as a notice, a restart included. It works at every stage from admission: one still being prepared, waiting its turn behind an earlier call or waiting for its permission is prepared, takes its turn and runs in the background, and the permission is still asked of the same reader — the question stays open and moves to the thread, never skipped; later calls that touch what it claims wait behind it, in this run and the thread's next ones. An invocation nothing can carry there, because no thread owns its outcome, answers \`unavailable\` with the reason. \`limit\` moves the time limit that ends it, named as a TOTAL allowance from the invocation's admission to run rather than a fresh clock — the time a permission question or a queue took before it is not counted, and an invocation not yet admitted refuses one — and it reports what actually ended rather than pretending that a wait was given up.
ONE INVOCATION AT A TIME. The address is the pair the run minted; there is no call to stop a run, and stopping a run is the thread's own act on its own door.
WHO MAY DO IT. The operator reaches any invocation of the project it is answering for. A thread reaches the invocations of its own thread and no others — another thread's invocation is answered as one this installation does not hold, because an address that travels must not become a probe.`;

const everyDoor = {
  doors: { http: 'perform' },
  tool: { capability: 'threads' },
  callers: 'any',
  subject: 'none',
  place: 'home',
  waits: [],
  lifetimes: [],
} as const;

const callKey = (input: { readonly runId: string; readonly toolCallId: string }): readonly ClaimTarget[] => [
  { kind: 'key', key: `call:${input.runId}/${input.toolCallId}` },
];

export const CALL_OPERATIONS = {
  read_calls: operation('read_calls', {
    approval: ASKS_NEVER,
    ...everyDoor,
    effect: 'read',
    identity: 'none',
    meaning:
      'Read the agent invocations this project is holding now: what each is doing, the thread it belongs to, and what it was asked to do.',
    grammar: `A READING OF THE LIVE PROCESS, never a transcript read. What answers is the runtime's own record of the invocations it is holding: every one still standing first, then the finished ones, newest first. The page is \`limit\` rows, ${pageRows(undefined, CALLS, ceilingOf(CALLS))} by default and ${ceilingOf(CALLS)} at most: it answers that page, the total held, and the \`cursor\` that continues the reading. A cursor handed to another question is refused: ask again with no cursor to open a new walk. A row carries no output: a finished call's transcript entry keeps what it did.
THREE SILENCES, and none of them is an empty machine. A restart keeps only what is owed: a background call whose ending has not yet reached its thread stands here, a previous process's as \`interrupted\`; every other call of a previous process is gone, which is not the same fact as work that never ran. An invocation whose thread belongs to no project is reached by no project's reading. A record that is gone is not a record that ended — a finished call past the last page has left the answer, while its own transcript entry keeps what it did.
A thread reads its OWN thread's invocations alone. The operator's own hand reads every invocation of the project it answers for.`,
    input: Schema.Struct({ limit: limitOf(CALLS), cursor: PAGE_CURSOR }),
    answer: arms({
      ok: {
        calls: Schema.Array(CallRecord),
        shown: Schema.Int,
        total: Schema.Int,
        next: Schema.NullOr(PageCursor),
        complete: Schema.Boolean,
      },
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
    confirmation: () => ({
      summary: 'Read the invocations this project is holding now?',
      consequence: 'Reading starts nothing, ends nothing and grants nothing.',
    }),
    confirmLabel: 'Read invocations',
    presentation: {
      running: 'Reading the invocations',
      done: 'Read the invocations',
      many: (count) => `Read the invocations ${count} times`,
    },
    subjects: () => [],
  }),

  control_call: operation('control_call', {
    approval: ASKS_IN_REVIEW,
    ...everyDoor,
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'Stop one agent invocation, hand its wait to the background, or move the time limit that ends it — without touching its run.',
    grammar: `${CONTROL_MECHANICS}
THE ADDRESS IS THE WHOLE OF IT. A pair this installation does not hold, a pair belonging to another thread or another project, and a pair whose invocation has already left the record are all answered the same way, so a reading is what tells them apart and no address becomes a way to ask about somebody else's work.`,
    input: Schema.Struct({ runId, toolCallId, control: CallControl }),
    answer: arms({
      ok: {
        runId: Schema.String,
        toolCallId: Schema.String,
        control: CallControlResult.fields.status,
        detail: CallControlResult.fields.detail,
      },
    }),
    refusals: ['unknown-invocation'],
    confirmation: (input) => ({
      summary:
        input.control.action === 'stop'
          ? `Stop the invocation ${input.toolCallId} of run ${input.runId}?`
          : input.control.action === 'background'
            ? `Hand the invocation ${input.toolCallId} of run ${input.runId} to the background?`
            : `Move the time limit of invocation ${input.toolCallId} of run ${input.runId}?`,
      facts: [{ label: 'Control', value: input.control.action }],
      consequence:
        'It reaches ONE invocation and never its run: the run continues, the model is told what became of its call, and nothing else that is running is touched.',
    }),
    confirmLabel: 'Control',
    intent: 'destructive',
    destructiveConsequence: () =>
      "Stopping an invocation ends that call and what it owns; the run it belongs to continues, and work already handed to the background is released from the model's wait rather than cancelled.",
    presentation: {
      running: 'Controlling an invocation',
      done: 'Controlled an invocation',
    },
    subjects: () => [],
    claims: { writes: callKey },
  }),

  wait_call: operation('wait_call', {
    approval: ASKS_IN_REVIEW,
    ...everyDoor,
    effect: 'write',
    identity: { key: 'call' },
    meaning: 'Wait, within a budget you name, for one agent invocation to end, and read how it ended.',
    grammar: `The budget bounds the WAITING and nothing else: its expiry answers \`running\`, ends no work and moves no limit. The operator's words or a report owed to you end the wait early when they arrive, with the invocation untouched.
A call still running answers in \`detail\` the step it last named, null when it names none. An ended call answers its \`phase\`. A call of your own thread that ran in the background answers its outcome's words here, and then its notice is not sent — the words reach you once, by whichever road comes first. \`words\` is null when the notice already reached the thread, or the call was never in the background.
The address and who may reach it are \`control_call\`'s: a pair this caller may not reach is answered as one this installation does not hold.`,
    input: Schema.Struct({
      runId,
      toolCallId,
      waitMs: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(LONGEST_ACT_MS)).annotate({
        description: `How long to wait, at most ${LONGEST_ACT_MS} ms. It bounds your waiting, never the work.`,
      }),
    }),
    answer: arms({
      ok: {
        runId: Schema.String,
        toolCallId: Schema.String,
        phase: CallRecord.fields.phase,
        detail: Schema.NullOr(Schema.String),
        words: Schema.NullOr(Schema.String),
      },
    }),
    refusals: ['unknown-invocation'],
    confirmation: (input) => ({
      summary: `Wait up to ${input.waitMs} ms for the invocation ${input.toolCallId} of run ${input.runId}?`,
      consequence: 'The budget bounds the waiting and nothing else: it ends no work.',
    }),
    confirmLabel: 'Wait',
    presentation: {
      running: 'Waiting for an invocation',
      done: 'Waited for an invocation',
    },
    called: (input) =>
      typeof input.runId !== 'string' || typeof input.toolCallId !== 'string' || !Number.isFinite(input.waitMs)
        ? { form: 'none' }
        : {
            form: 'none',
            title: 'Waiting for an invocation',
            awaitsMs: input.waitMs,
            reference: { kind: 'call', runId: input.runId, toolCallId: input.toolCallId },
          },
    watches: () => true,
    subjects: () => [],
    claims: { writes: callKey },
  }),
};

export type CallOperationId = keyof typeof CALL_OPERATIONS;

export const CALL_OPERATION_IDS = Object.keys(CALL_OPERATIONS) as readonly CallOperationId[];
