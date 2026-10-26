import { Effect } from 'effect';
import { body, type OperationPair, pair } from '../../platform/contract/service/body.js';
import { CurrentProject } from '../../projects/contract/service/caller.js';
import { wireSnapshotPayload } from '../../threads/list/wire.js';
import { ThreadEvidence } from '../../threads/contract/service/evidence.js';
import { stateThreads, threadBasis } from '../../threads/list/basis.js';
import { EVIDENCE_OPERATIONS as OPS, type EvidenceOperationId } from '../contract/wire/operations/evidence.js';
import { declaredRefusals } from '../../threads/refusalAnswers.js';

export const EVIDENCE_PAIRS: { readonly [K in EvidenceOperationId]: OperationPair<(typeof OPS)[K]> } = {
  read_thread_snapshot: pair(
    OPS.read_thread_snapshot,
    body(OPS.read_thread_snapshot, {
      execute: (input) =>
        declaredRefusals(OPS.read_thread_snapshot)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const snapshot = yield* (yield* ThreadEvidence).snapshot(input.threadId, call.project.id);
            const basis = yield* threadBasis(stateThreads(snapshot, call.project.id));
            return wireSnapshotPayload(snapshot, basis);
          }),
        ),
    }),
  ),
  read_thread_held: pair(
    OPS.read_thread_held,
    body(OPS.read_thread_held, {
      execute: (input) =>
        declaredRefusals(OPS.read_thread_held)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const held = yield* (yield* ThreadEvidence).held(input.threadId, call.project.id);
            return { status: 'read' as const, ...held };
          }),
        ),
    }),
  ),
  read_thread_composition: pair(
    OPS.read_thread_composition,
    body(OPS.read_thread_composition, {
      execute: (input) =>
        declaredRefusals(OPS.read_thread_composition)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const reading = yield* (yield* ThreadEvidence).composition(input.threadId, call.project.id);
            return { status: 'read' as const, ...reading };
          }),
        ),
    }),
  ),
  read_thread_entry: pair(
    OPS.read_thread_entry,
    body(OPS.read_thread_entry, {
      execute: (input) =>
        declaredRefusals(OPS.read_thread_entry)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const read = yield* (yield* ThreadEvidence).entry(input.threadId, call.project.id, input.entryId);
            return read === null ? { status: 'absent' as const } : { status: 'found' as const, entry: read.entry };
          }),
        ),
    }),
  ),
  read_thread_entries: pair(
    OPS.read_thread_entries,
    body(OPS.read_thread_entries, {
      execute: (input) =>
        declaredRefusals(OPS.read_thread_entries)(
          Effect.gen(function* () {
            const call = yield* yield* CurrentProject;
            const page = yield* (yield* ThreadEvidence).entries(input.threadId, call.project.id, input.before);
            return { status: 'read' as const, ...page };
          }),
        ),
    }),
  ),
};
