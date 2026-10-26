import { and, eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Units } from '../../platform/contract/service/units.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { MergeReceipt } from '../contract/wire/merge.js';
import type { MergeReceipts } from '../contract/service/receipts.js';
import { mergeReceipt } from './tables.js';

const receiptOf = (row: typeof mergeReceipt.$inferSelect): MergeReceipt => ({
  rootId: RootId.make(row.rootId),
  commit: row.commit,
  name: row.name,
  branch: row.branch,
  base: row.base,
  mode: row.mode,
  waitedSince: row.waitedSince === null ? null : row.waitedSince.toISOString(),
  after: { act: row.afterAct, outcome: row.afterOutcome, reason: row.afterReason },
  addressees: row.addressees,
  at: row.at.toISOString(),
});

export const mergeReceipts = (db: StoreDb<'machine'>, units: Units<'machine'>): MergeReceipts['Service'] => ({
  read: (rootId, commit) =>
    units.read((unit) =>
      Effect.map(
        unit.run(
          db
            .select()
            .from(mergeReceipt)
            .where(and(eq(mergeReceipt.rootId, rootId), eq(mergeReceipt.commit, commit)))
            .get(),
        ),
        (row) => (row === undefined ? null : receiptOf(row)),
      ),
    ),
  recorded: (unit, rootId, commit) =>
    Effect.map(
      unit.run(
        db
          .select({ rootId: mergeReceipt.rootId })
          .from(mergeReceipt)
          .where(and(eq(mergeReceipt.rootId, rootId), eq(mergeReceipt.commit, commit)))
          .get(),
      ),
      (row) => row !== undefined,
    ),
  record: (unit, projectId, receipt) =>
    Effect.asVoid(
      unit.run(
        db
          .insert(mergeReceipt)
          .values({
            rootId: receipt.rootId,
            commit: receipt.commit,
            projectId,
            name: receipt.name,
            branch: receipt.branch,
            base: receipt.base,
            mode: receipt.mode,
            waitedSince: receipt.waitedSince === null ? null : new Date(receipt.waitedSince),
            afterAct: receipt.after.act,
            afterOutcome: receipt.after.outcome,
            afterReason: receipt.after.reason,
            addressees: receipt.addressees,
            at: new Date(receipt.at),
          })
          .onConflictDoNothing(),
      ),
    ),
});
