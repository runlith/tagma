import { and, eq } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore, type StoreDb } from '../../platform/contract/service/store.js';
import { MachineUnits, type Units } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import type { CallKey } from '../../platform/contract/wire/ids.js';
import type { WorkOrigin } from '../../workspace/contract/wire/place.js';
import { receipt as publicationReceipt } from '../../platform/git/publish.js';
import { SubmitReceipt } from '../contract/wire/receipt.js';
import { submitReceipt } from './tables.js';

const recording = writes('submit_work.receipt', [submitReceipt]);

const whereCall = (work: WorkOrigin, callId: string) =>
  and(eq(submitReceipt.threadId, work.threadId), eq(submitReceipt.projectId, work.projectId), eq(submitReceipt.callId, callId));

export const witnessSubmission = (db: StoreDb<'machine'>, units: Units<'machine'>, witness: typeof submitReceipt.$inferInsert) =>
  units.write(recording, (unit) =>
    Effect.asVoid(
      unit.run(
        db
          .insert(submitReceipt)
          .values(witness)
          .onConflictDoUpdate({
            target: [submitReceipt.threadId, submitReceipt.projectId, submitReceipt.callId],
            set: witness,
          }),
      ),
    ),
  );

export const completeSubmission = (
  db: StoreDb<'machine'>,
  units: Units<'machine'>,
  work: WorkOrigin,
  callId: string,
  submitted: SubmitReceipt,
) =>
  units.write(recording, (unit) =>
    Effect.asVoid(unit.run(db.update(submitReceipt).set({ submitted, complete: true }).where(whereCall(work, callId)))),
  );

export const settleSubmission = Effect.fn('submit_work.settle')(function* (key: CallKey) {
  if (key.actorRef.kind !== 'thread') return { status: 'unknown' as const, current: null };
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const work = { threadId: key.actorRef.threadId, projectId: key.actorRef.projectId };
  const row = yield* units.read((unit) => unit.run(db.select().from(submitReceipt).where(whereCall(work, key.key)).get()));
  if (row === undefined) return { status: 'unknown' as const, current: null };
  const submitted = yield* Schema.decodeUnknownEffect(SubmitReceipt)(row.submitted).pipe(
    Effect.mapError(
      (failure) =>
        new GateRefusal('root-unproven', `the receipt of this submit_work call is unreadable: ${failure.message}`, [
          'read_changes and read_checkout_history to establish what landed before submitting again',
        ]),
    ),
  );
  if (!row.complete) {
    const published = yield* publicationReceipt(yield* Git, row.checkout, row.ref, row.commit, row.job).pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('root-unproven', `whether this submit_work call published could not be read: ${failure.message}`, [
            'read_changes and read_checkout_history before submitting again',
          ]),
      ),
    );
    if (published === 'uncertain') return { status: 'unknown' as const, current: { commit: row.commit, checkout: row.checkout } };
  }
  return { status: 'happened' as const, evidence: { status: 'ok' as const, submitted } };
});
