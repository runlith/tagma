import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import type { WriteSet } from '../../platform/contract/service/writes.js';
import { type SnapshotFailed, StoreSnapshots } from '../../platform/contract/service/snapshots.js';

const RETIREMENT: WriteSet = {
  operation: 'TransitionRetirement.portion',
  durability: 'relaxed',
  reach: new Map([['retired_run_transition', 'all']]),
};

const CANDIDATES = 64;
type Candidate = { readonly id: number; readonly bytes: number };
export type TransitionRetired = {
  readonly removed: number;
  readonly portions: number;
  readonly maxHeldMs: number;
  readonly blockedBy?: 'snapshot';
};

export const makeTransitionRetirement = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const snapshots = yield* StoreSnapshots;
  return {
    pass: Effect.fn('TransitionRetirement.pass')(function* (): Effect.fn.Return<TransitionRetired, StoreFailure | SnapshotFailed> {
      const pending = yield* units.read((unit) =>
        unit.run(store.db.all(sql`select 1 from sqlite_master where type = 'table' and name = 'retired_run_transition'`)),
      );
      if (pending.length === 0) return { removed: 0, portions: 0, maxHeldMs: 0 };
      if (yield* snapshots.covers(store.path, 'retired_run_transition')) {
        yield* Effect.logInfo('run transition retirement waits for its snapshot', { path: store.path });
        return { removed: 0, portions: 0, maxHeldMs: 0, blockedBy: 'snapshot' };
      }
      return yield* store.readOnly((reader) =>
        Effect.gen(function* () {
          const [page] = yield* reader.all<{ page_size: number }>(sql`pragma page_size`);
          const coldBytes = page!.page_size * 4;
          let removed = 0;
          let portions = 0;
          let maxHeldMs = 0;
          let candidates: readonly Candidate[] = [];
          for (;;) {
            if (candidates.length === 0)
              candidates = yield* reader.all<Candidate>(
                sql`select rowid as id, octet_length(result) as bytes from retired_run_transition order by rowid limit ${CANDIDATES}`,
              );
            const first = candidates[0];
            const large = first !== undefined && first.bytes > coldBytes;
            let count = 0;
            if (large) {
              yield* reader.all(sql`select length(result) from retired_run_transition where rowid = ${first.id}`);
              count = 1;
            } else {
              let bytes = 0;
              for (const candidate of candidates) {
                if (bytes + candidate.bytes > coldBytes) break;
                bytes += candidate.bytes;
                count += 1;
              }
            }
            const ids = candidates.slice(0, count).map((candidate) => candidate.id);
            let started = 0;
            const landed = yield* units.write(RETIREMENT, (unit) =>
              Effect.gen(function* () {
                started = performance.now();
                const [before] = yield* unit.run(store.db.all<{ secure_delete: 0 | 1 | 2 }>(sql`pragma secure_delete`));
                yield* unit.run(store.db.run(sql`pragma secure_delete = OFF`));
                return yield* Effect.gen(function* () {
                  if (ids.length === 0) {
                    yield* unit.run(store.db.run(sql`drop table retired_run_transition`));
                    return 0;
                  }
                  const rows = yield* unit.run(
                    store.db.all(
                      sql`delete from retired_run_transition where rowid in (select value from json_each(${JSON.stringify(ids)})) returning rowid`,
                    ),
                  );
                  return rows.length;
                }).pipe(
                  Effect.ensuring(
                    unit
                      .run(store.db.run(sql.raw(`pragma secure_delete = ${['OFF', 'ON', 'FAST'][before!.secure_delete]}`)))
                      .pipe(Effect.orDie),
                  ),
                );
              }),
            );
            const heldMs = performance.now() - started;
            removed += landed;
            portions += 1;
            maxHeldMs = Math.max(maxHeldMs, heldMs);
            if (ids.length === 0) {
              yield* Effect.logInfo('run transition retirement completed', { removed, portions, maxHeldMs });
              return { removed, portions, maxHeldMs };
            }
            candidates = candidates.slice(count);
            yield* Effect.sleep(Math.max(25, heldMs));
          }
        }),
      );
    }),
  };
});
