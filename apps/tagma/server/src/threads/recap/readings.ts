import { inArray } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { among } from '../../platform/store/rows.js';
import type { Settings } from '../../settings/contract/service/values.js';
import type { RecapStatus, ThreadRecap } from '../../thread-record/contract/wire/recap.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { ThreadRecaps } from '../contract/service/recaps.js';
import { recap } from '../contract/wire/settings.js';
import type { RecapAttempt, RecapReading } from '../contract/wire/recap.js';
import { recapStatusOf, statusesOf } from './standing.js';

export const automaticRecaps = (settings: Settings['Service'], projectId: number | null) =>
  projectId === null ? Effect.succeed(false) : Effect.map(settings.held(recap, projectId), (shown) => shown());

export const recapReading = (kept: ThreadRecap, status: RecapStatus): RecapReading => ({
  summary: kept.summary,
  next: kept.next,
  status,
  basis: kept.basis,
});

export const makeThreadRecaps = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const attempts = new Map<string, RecapAttempt>();
  return ThreadRecaps.of({
    readings: Effect.fnUntraced(function* (subjects) {
      const ids = subjects.map((subject) => subject.id);
      if (ids.length === 0) return new Map<string, RecapReading>();
      const rows = yield* units.read((unit) =>
        unit.run(
          db
            .select({ id: threadRecord.id, recap: threadRecord.recap, status: recapStatusOf(threadRecord.id, threadRecord.recap) })
            .from(threadRecord)
            .where(inArray(threadRecord.id, among(ids))),
        ),
      );
      return new Map(
        rows.flatMap((row) => (row.recap === null || row.status === null ? [] : [[row.id, recapReading(row.recap, row.status)] as const])),
      );
    }),
    reading: Effect.fnUntraced(function* (subject, stored) {
      if (stored === null) return null;
      const status = (yield* units.read((unit) => statusesOf(db, unit, [subject.id]))).get(subject.id);
      return status === undefined ? null : recapReading(stored, status);
    }),
    attempt: (threadId) => attempts.get(threadId) ?? null,
    track: (threadId, attempt) => {
      if (attempt === null) attempts.delete(threadId);
      else attempts.set(threadId, attempt);
    },
  });
});
