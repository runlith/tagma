import { Effect } from 'effect';
import { said } from '../../platform/contract/service/presentation.js';
import { keyOrder, page, pageRows, pastKey, readCursor, type PageDirection, type PageKey, type PageQuestion } from '@runlith/paging';
import type { CallRecord } from '@runlith/agent/callProgress';
import { CallActivity, type CallScope } from '../contract/service/calls.js';
import { OwedCalls } from '../../threads/contract/service/owedCalls.js';
import type { Caller } from '../../platform/contract/wire/caller.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { CALL_OPERATIONS as OPS, type CallOperationId } from '../contract/wire/operations/calls.js';
import { CALLS } from '../contract/wire/pages.js';
import { cursorRefusal } from '../../platform/contract/wire/refusal.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { callsText } from '../voice/calls.js';

const scopeOf = (caller: Caller, projectId: number): CallScope =>
  caller.actor.kind === 'thread' ? { projectId, threadId: caller.actor.threadId } : { projectId };

const CALL_ORDER: readonly PageDirection[] = ['asc', 'desc', 'asc', 'asc'];

const callKey = (record: CallRecord): PageKey => [
  record.endedAt === null ? 0 : 1,
  record.endedAt ?? record.startedAt,
  record.runId,
  record.toolCallId,
];

const callOrder = keyOrder(CALL_ORDER);

export const readCalls = Effect.fnUntraced(function* (input: typeof OPS.read_calls.input.Type, _prepared: undefined, caller: Caller) {
  const call = yield* yield* CurrentProject;
  const scope = scopeOf(caller, call.project.id);
  const question: PageQuestion = {
    operation: 'read_calls',
    selection: {
      projectId: scope.projectId,
      threadId: scope.threadId,
    },
    order: CALLS.order,
  };
  const continued = input.cursor === undefined ? undefined : readCursor(input.cursor, question);
  if (continued !== undefined && 'refused' in continued) return yield* cursorRefusal(continued.refused);
  const live = yield* (yield* CallActivity).held(scope);
  const standing = new Set(live.map((record) => JSON.stringify([record.runId, record.toolCallId])));
  const owed = (yield* (yield* OwedCalls).owed(scope)).filter((record) => !standing.has(JSON.stringify([record.runId, record.toolCallId])));
  const held = [...live, ...owed];
  const ordered = [...held].sort((left, right) => callOrder(callKey(left), callKey(right)));
  const rest = continued === undefined ? ordered : pastKey(ordered, callKey, CALL_ORDER, continued.at);
  const cut = page({
    rows: rest,
    asked: pageRows(input.limit, CALLS, ceilingOf(CALLS)),
    keyOf: callKey,
    question,
    total: held.length,
  });
  return { status: 'ok' as const, calls: cut.rows, shown: cut.shown, total: held.length, next: cut.next, complete: cut.complete };
});

export const CALL_PAIRS: { readonly [K in CallOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_calls: pair(OPS.read_calls, body(OPS.read_calls, { execute: readCalls, voice: said(callsText) })),

  control_call: pair(
    OPS.control_call,
    body(OPS.control_call, {
      execute: Effect.fnUntraced(function* (input, _prepared: undefined, caller: Caller) {
        const call = yield* yield* CurrentProject;
        const outcome = yield* (yield* CallActivity).control(
          scopeOf(caller, call.project.id),
          { runId: input.runId, toolCallId: input.toolCallId },
          input.control,
        );
        return { status: 'ok' as const, runId: input.runId, toolCallId: input.toolCallId, control: outcome.status, detail: outcome.detail };
      }),
    }),
  ),
};
