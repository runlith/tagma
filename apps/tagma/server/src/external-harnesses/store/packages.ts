import { and, isNotNull, sql } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { PluginRevisions, RevisionRecords } from '../../plugins/contract/service/plugins.js';
import { externalSession } from '../../threads/store/harnessFacet.js';
import { HarnessAdapters } from '../contract/service/adapters.js';

const pinned = sql<string | null>`json_extract(${externalSession.facet}, '$.session.package')`;

const live = sql`coalesce(json_extract(${externalSession.facet}, '$.session.state'), 'ended') != 'ended'`;

export const recordedPackages = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  return units.read((unit) =>
    Effect.map(
      unit.run(
        db
          .select({ directory: pinned })
          .from(externalSession)
          .where(and(isNotNull(externalSession.leaseBeat), isNotNull(pinned), live)),
      ),
      (rows): ReadonlySet<string> => new Set(rows.flatMap((row) => (row.directory === null ? [] : [row.directory]))),
    ),
  );
});

export const packageHoldersLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const adapters = yield* HarnessAdapters;
    yield* (yield* PluginRevisions).register({
      standing: () => new Set(adapters.all().flatMap((row) => (row.package === undefined ? [] : [row.package]))),
    });
  }),
);

export const revisionRecordsLayer = Layer.effect(
  RevisionRecords,
  Effect.map(recordedPackages, (recorded) => RevisionRecords.of({ recorded })),
);
