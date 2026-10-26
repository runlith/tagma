import { sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../../platform/contract/service/store.js';
import { writes } from '../../platform/contract/service/writes.js';
import { WorkSpells } from '../../thread-record/contract/service/spells.js';
import { threadLiveSpell } from '../store/mandate.js';
import { liveRootOf } from '../../thread-record/lineage.js';
import { recordsAs } from '../../thread-record/facts.js';
import { activeSessions } from './select.js';

export const makeThreadLiveSpells = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  return WorkSpells.of({
    writes: writes('ThreadLiveSpells', [threadLiveSpell]),
    begin: (threadId, at, tx) =>
      Effect.asVoid(
        tx.run(
          db
            .insert(threadLiveSpell)
            .values({ threadId: liveRootOf(threadId), startedAt: at })
            .onConflictDoNothing(),
        ),
      ),
    end: (threadId, tx) => {
      const root = liveRootOf(threadId);
      return Effect.asVoid(
        tx.run(
          db.delete(threadLiveSpell).where(
            sql`${threadLiveSpell.threadId} = ${root}
            and not exists (
              with recursive family(id) as (
                select ${root}
                union all
                select kin.id
                  from ${recordsAs('kin')}
                  join family parent on kin.parent_id = parent.id
                 where kin.archived_at is null
              )
              select 1
                from ${activeSessions} active
                 join family on active.thread_id = family.id
            )`,
          ),
        ),
      );
    },
  });
});
