import { Effect } from 'effect';
import { sql } from 'drizzle-orm';
import type { MachineUnits, Unit } from '../../platform/contract/service/units.js';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { changeLogWrites } from './tables.js';

const misplaced = sql`not exists (select 1 from project_root where root_id = workspace_change.checkout and project_id = workspace_change.project_id)
  and exists (select 1 from project_root where root_id = workspace_change.checkout)`;
const pending = sql`((holder <> 'operator' and holder_project_id is null) or (holder = 'operator' and ${misplaced}))`;

export const formChangeHomes = Effect.fn('ChangeRecord.formHomes')(function* (
  units: MachineUnits['Service'],
  store: MachineStore['Service'],
  holder?: string,
): Effect.fn.Return<void, StoreFailure> {
  const scope = holder === undefined ? sql`state in ('writing', 'held')` : sql`holder = ${holder}`;
  const index = holder === undefined ? sql`workspace_change_standing_order_idx` : sql`workspace_change_holder_idx`;
  const unfinished = yield* units.read((unit) =>
    unit.run(store.db.all(sql`select 1 from workspace_change indexed by ${index} where ${scope} and ${pending} limit 1`)),
  );
  if (unfinished.length === 0) return;
  yield* units.write(changeLogWrites, (unit) =>
    unit.run(
      store.db.run(sql`
    update workspace_change set
      holder_project_id = case when holder = 'operator' then null
        else coalesce((select project_id from thread where thread.id = workspace_change.holder), project_id) end,
      project_id = case
        when exists (select 1 from project_root where root_id = workspace_change.checkout and project_id = workspace_change.project_id) then project_id
        when (select count(*) from project_root where root_id = workspace_change.checkout) = 0 then project_id
        when (select count(*) from project_root where root_id = workspace_change.checkout) = 1 then (select min(project_id) from project_root where root_id = workspace_change.checkout)
        else null end
    where rowid in (select rowid from workspace_change indexed by ${index} where ${scope} and ${pending})
  `),
    ),
  );
});

export const readHolder = <A, E>(
  units: MachineUnits['Service'],
  store: MachineStore['Service'],
  holder: string,
  read: (unit: Unit<'machine'>) => Effect.Effect<A, E>,
): Effect.Effect<A, E | StoreFailure> => Effect.andThen(formChangeHomes(units, store, holder), units.read(read));
