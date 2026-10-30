import { Effect } from 'effect';
import { pageRows } from '@runlith/paging';
import { startingRun, threadSaidOnTheWire } from '@runlith/agent/protocol/realtime';
import { revertThreadLines, runFilesOfThread } from '../../change-record/contract/service/threadLines.js';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { ceilingOf } from '../../platform/contract/wire/pageFamily.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { TURN_OPERATIONS as OPS, type TurnOperationId } from '../contract/wire/operations/turns.js';
import { declaredRefusals } from '../refusalAnswers.js';
import { QuestionAnswers } from '../turns/answers.js';
import { ThreadAdjustments } from '../turns/adjustments.js';
import { ThreadEvidence } from '../contract/service/evidence.js';
import { STATUSES } from '../contract/wire/statuses.js';
import { ENDINGS } from '../contract/wire/endings.js';
import { EndingRedelivery } from '../contract/service/redelivery.js';
import { namedPage } from './namedPages.js';
import { stateThreads, threadBasis } from '../list/basis.js';
import { wireSnapshotPayload } from '../list/wire.js';
import { ThreadRewinds } from '../turns/rewinds.js';
import { ThreadTurns } from '../turns/acts.js';
import { admitCallerOf } from '../turns/caller.js';
import { REWIND_FILES } from '../contract/wire/rewind.js';

export const TURN_PAIRS: { readonly [K in TurnOperationId]: OperationPair<(typeof OPS)[K]> } = {
  start_turn: pair(
    OPS.start_turn,
    body(OPS.start_turn, {
      execute: ({ threadId, text, attachments, key }, _prepared, caller) =>
        declaredRefusals(OPS.start_turn)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return threadSaidOnTheWire(
              yield* (yield* ThreadTurns).send(threadId, call.project.id, text ?? '', attachments, {
                key,
                caller: admitCallerOf(caller.actor),
              }),
            );
          }),
        ),
    }),
  ),
  queue_turn: pair(
    OPS.queue_turn,
    body(OPS.queue_turn, {
      execute: ({ threadId, text, attachments, key }, _prepared, caller) =>
        declaredRefusals(OPS.queue_turn)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return threadSaidOnTheWire(
              yield* (yield* ThreadTurns).queue(threadId, call.project.id, text ?? '', attachments, {
                key,
                caller: admitCallerOf(caller.actor),
              }),
            );
          }),
        ),
    }),
  ),
  steer_turn: pair(
    OPS.steer_turn,
    body(OPS.steer_turn, {
      execute: ({ threadId, key, ...steer }, _prepared, caller) =>
        declaredRefusals(OPS.steer_turn)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return threadSaidOnTheWire(
              yield* (yield* ThreadTurns).steer(threadId, call.project.id, steer, { key, caller: admitCallerOf(caller.actor) }),
            );
          }),
        ),
    }),
  ),
  read_endings: pair(
    OPS.read_endings,
    body(OPS.read_endings, {
      execute: ({ threads, cursor, limit, depth }) =>
        declaredRefusals(OPS.read_endings)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const walked = yield* namedPage({
              operation: 'read_endings',
              family: ENDINGS,
              project: call.project.id,
              threads,
              cursor,
              limit,
            });
            const rows = yield* (yield* ThreadEvidence).endings(walked.ids, call.project.id, depth ?? 1);
            return { status: 'ok' as const, rows, total: walked.total, cursor: walked.next };
          }),
        ),
    }),
  ),
  redeliver_ending: pair(
    OPS.redeliver_ending,
    body(OPS.redeliver_ending, {
      execute: ({ threadId, runId }) =>
        declaredRefusals(OPS.redeliver_ending)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return { status: yield* (yield* EndingRedelivery).redeliver(threadId, call.project.id, runId) };
          }),
        ),
    }),
  ),
  unqueue_turn: pair(
    OPS.unqueue_turn,
    body(OPS.unqueue_turn, {
      execute: ({ threadId, inputId }) =>
        declaredRefusals(OPS.unqueue_turn)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const taken = yield* (yield* ThreadTurns).unqueue(threadId, call.project.id, inputId);
            return { status: taken ? ('unqueued' as const) : ('not-queued' as const) };
          }),
        ),
    }),
  ),
  answer_question: pair(
    OPS.answer_question,
    body(OPS.answer_question, {
      execute: ({ threadId, ...answer }) =>
        declaredRefusals(OPS.answer_question)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const asks = yield* QuestionAnswers;
            return yield* startingRun(
              Effect.map(asks.answer(threadId, call.project.id, answer), (run) => ({ status: 'started' as const, runId: run.runId })),
            );
          }),
        ),
    }),
  ),
  set_thread_authority: pair(
    OPS.set_thread_authority,
    body(OPS.set_thread_authority, {
      execute: ({ threadId, mode }) =>
        declaredRefusals(OPS.set_thread_authority)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const snapshot = yield* (yield* ThreadAdjustments).setAuthorityMode(threadId, call.project.id, mode);
            const basis = yield* threadBasis(stateThreads(snapshot, call.project.id));
            return wireSnapshotPayload(snapshot, basis);
          }),
        ),
    }),
  ),
  stop_run: pair(
    OPS.stop_run,
    body(OPS.stop_run, {
      execute: ({ threadId, runId, withdraw }) =>
        declaredRefusals(OPS.stop_run)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return yield* (yield* ThreadTurns).stop(threadId, call.project.id, runId, withdraw ? { withdraw: true } : {});
          }),
        ),
    }),
  ),
  rewind_thread: pair(
    OPS.rewind_thread,
    body(OPS.rewind_thread, {
      execute: ({ threadId, at, scope, revertLines, key }) =>
        declaredRefusals(OPS.rewind_thread)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const answer = yield* (yield* ThreadRewinds).rewind(threadId, call.project.id, {
              at,
              scope,
              key,
            });
            const reverted = revertLines === true ? yield* revertedAfter(threadId, answer.runIds) : undefined;
            return { status: 'rewound' as const, ...answer, reverted };
          }),
        ),
    }),
  ),
  restore_thread: pair(
    OPS.restore_thread,
    body(OPS.restore_thread, {
      execute: ({ threadId, rewindId, key }) =>
        declaredRefusals(OPS.restore_thread)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const restored = yield* (yield* ThreadRewinds).restore(threadId, call.project.id, {
              rewindId,
              key,
            });
            return { status: 'restored' as const, ...restored };
          }),
        ),
    }),
  ),
  read_rewind: pair(
    OPS.read_rewind,
    body(OPS.read_rewind, {
      execute: ({ threadId, at, scope, limit, cursor }) =>
        declaredRefusals(OPS.read_rewind)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const { preview, drafts } = yield* (yield* ThreadRewinds).preview(threadId, call.project.id, { at, scope });
            const graph = yield* (yield* ThreadEvidence).rewindActs(threadId, call.project.id, preview.runIds);
            const files = yield* runFilesOfThread(
              { threadId, runIds: preview.runIds },
              { limit: pageRows(limit, REWIND_FILES, ceilingOf(REWIND_FILES)), after: cursor },
            ).pipe(
              Effect.catchTag('GateRefusal', (refusal) =>
                Effect.succeed({ root: null, files: [], total: 0, next: null, unavailable: refusal.reason }),
              ),
            );
            return { status: 'preview' as const, preview, drafts, files, graph };
          }),
        ),
    }),
  ),
  read_rewind_points: pair(
    OPS.read_rewind_points,
    body(OPS.read_rewind_points, {
      execute: ({ threadId }) =>
        declaredRefusals(OPS.read_rewind_points)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            return { status: 'points' as const, ...(yield* (yield* ThreadRewinds).points(threadId, call.project.id)) };
          }),
        ),
    }),
  ),
  branch_thread: pair(
    OPS.branch_thread,
    body(OPS.branch_thread, {
      execute: ({ threadId, before, key }) =>
        declaredRefusals(OPS.branch_thread)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const branch = yield* (yield* ThreadRewinds).branch(threadId, call.project.id, {
              before,
              key,
            });
            return { status: 'branched' as const, ...branch };
          }),
        ),
    }),
  ),
  read_statuses: pair(
    OPS.read_statuses,
    body(OPS.read_statuses, {
      execute: ({ threads, cursor, limit }) =>
        declaredRefusals(OPS.read_statuses)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const walked = yield* namedPage({
              operation: 'read_statuses',
              family: STATUSES,
              project: call.project.id,
              threads,
              cursor,
              limit,
            });
            const rows = yield* (yield* ThreadEvidence).statuses(walked.ids, call.project.id);
            return { status: 'ok' as const, rows, total: walked.total, cursor: walked.next };
          }),
        ),
    }),
  ),
};

const revertedAfter = (threadId: string, runIds: readonly string[]) =>
  revertThreadLines({ threadId, runIds }).pipe(
    Effect.map((result) => ({ status: 'reverted' as const, result })),
    Effect.catchTags({
      GateRefusal: (refusal) => refusedRevert(refusal.code, refusal.reason),
      SqlError: (failure) => refusedRevert('store-failed', failure.message),
      EffectDrizzleQueryError: (failure) => refusedRevert('store-failed', failure.message),
    }),
  );

const refusedRevert = (code: string, reason: string) => Effect.succeed({ status: 'refused' as const, code, reason });
