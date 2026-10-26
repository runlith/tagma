import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { MachineUnits } from '../platform/contract/service/units.js';
import { writes } from '../platform/contract/service/writes.js';
import type { StoredFailure } from '../platform/store/crossing.js';
import type { HarnessBinding } from '../threads/contract/wire/harness/observation.js';
import type { ThreadRecords } from '../thread-record/contract/service/records.js';
import type { TitleProvenance } from '../thread-record/contract/wire/title.js';
import { threadRecord } from '../thread-record/store/table.js';
import { externalSession } from '../threads/store/harnessFacet.js';

const ADOPTABLE: readonly TitleProvenance[] = ['random', 'harness'];

export const adoptSessionTitle = (
  db: StoreDb<'machine'>,
  units: MachineUnits['Service'],
  records: ThreadRecords['Service'],
  threadId: string,
  title: string,
  expected: number,
  binding: HarnessBinding,
): Effect.Effect<boolean, StoredFailure> => {
  const key = binding.rootKey ?? binding.workKey ?? null;
  if (title.trim() === '' || binding.sessionId === null || binding.execution === null || key === null) return Effect.succeed(false);
  const execution = binding.execution;
  return units.write(writes('external.adoptSessionTitle', [threadRecord]), (unit) =>
    Effect.gen(function* () {
      const record = yield* records.facts(threadId, unit);
      if (record === undefined || record.parentId !== null) return false;
      const session = yield* unit.run(
        db.select({ facet: externalSession.facet }).from(externalSession).where(eq(externalSession.id, threadId)).get(),
      );
      const standing = session?.facet.observation?.binding ?? null;
      if (
        standing === null ||
        standing.sessionId !== binding.sessionId ||
        (standing.rootKey ?? standing.workKey ?? null) !== key ||
        standing.execution?.execution !== execution.execution ||
        standing.execution?.incarnation !== execution.incarnation
      )
        return false;
      return yield* records.adoptTitle(unit, threadId, title, expected, ADOPTABLE);
    }),
  );
};
