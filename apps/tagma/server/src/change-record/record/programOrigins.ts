import { Effect } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { chunk, unique } from '@runlith/utils/collection';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { ABSENT_DIGEST } from '../contract/service/commands.js';
import type { PreparedPlace } from '../contract/service/prepared.js';
import { commandUnattributed } from '../store/commandTables.js';
import { PLACES_PER_STATEMENT } from './places.js';

type ObservedProgram = { readonly digest: string | null; readonly commandLine: string | null };

export const observedPrograms = Effect.fn('ChangeRecord.observedPrograms')(function* (
  place: PreparedPlace,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, readonly ObservedProgram[]>, StoreFailure> {
  const found = new Map<string, ObservedProgram[]>();
  for (const group of chunk(unique(paths), PLACES_PER_STATEMENT)) {
    const rows = yield* place.units.read((unit) =>
      unit.run(
        place.store.db
          .select({ path: commandUnattributed.path, digest: commandUnattributed.digest, commandLine: commandUnattributed.commandLine })
          .from(commandUnattributed)
          .where(and(eq(commandUnattributed.checkout, place.checkout), inArray(commandUnattributed.path, group)))
          .orderBy(commandUnattributed.at, commandUnattributed.id),
      ),
    );
    for (const row of rows) {
      if (row.digest === ABSENT_DIGEST) continue;
      const standing = found.get(row.path) ?? [];
      standing.push({ digest: row.digest, commandLine: row.commandLine });
      found.set(row.path, standing);
    }
  }
  return found;
});
