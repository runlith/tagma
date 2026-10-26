import { Context, Effect } from 'effect';
import type { ThreadResourceKind } from '@runlith/agent/resources/ResourcesConfig';
import type { ThreadResourceValues } from '@runlith/agent/thread/storage/resources';
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { among } from '../../platform/store/rows.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { threadResource } from './tables.js';
import { writes } from '../../platform/contract/service/writes.js';
import { stored } from '../../platform/store/crossing.js';

export type ThreadResourceStore = Effect.Success<typeof makeThreadResourceStore>;

export const makeThreadResourceStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const rows = (call: string, where: SQL, tx?: Unit<'machine'>) => {
    const read = (unit: Unit<'machine'>) =>
      unit.run(db.select().from(threadResource).where(where).orderBy(asc(threadResource.kind), asc(threadResource.id)).all());
    return stored(call)(tx ? read(tx) : units.read(read));
  };
  const holdIn = Effect.fnUntraced(function* (values: ThreadResourceValues, unit: Unit<'machine'>) {
    const row = yield* unit.run(
      db
        .insert(threadResource)
        .values({ kind: values.kind, id: values.id, threadId: values.threadId })
        .onConflictDoUpdate({
          target: [threadResource.kind, threadResource.id],
          set: { threadId: values.threadId },
        })
        .returning()
        .get(),
    );
    if (!row) return yield* Effect.die(new Error('The resource ledger returned no row for a hold.'));
    return row;
  });
  return {
    hold: (values: ThreadResourceValues, tx?: Unit<'machine'>) =>
      stored('hold')(
        tx ? holdIn(values, tx) : units.write(writes('ThreadResourceStore.hold', [threadResource]), (unit) => holdIn(values, unit)),
      ),
    release: (kind: string, ids: readonly string[], tx?: Unit<'machine'>) => {
      const write = (unit: Unit<'machine'>) =>
        Effect.map(
          unit.run(
            db
              .delete(threadResource)
              .where(and(eq(threadResource.kind, kind), inArray(threadResource.id, among(ids))))
              .returning({ id: threadResource.id })
              .all(),
          ),
          (deleted) => deleted.length,
        );
      return stored('release')(tx ? write(tx) : units.write(writes('ThreadResourceStore.release', [threadResource]), write));
    },
    held: (threadIds: readonly string[], tx?: Unit<'machine'>) => rows('held', inArray(threadResource.threadId, among(threadIds)), tx),
    detached: (tx?: Unit<'machine'>) => rows('detached', isNull(threadResource.threadId), tx),
  };
});

export class ThreadResources extends Context.Service<
  ThreadResources,
  {
    readonly storage: ThreadResourceStore;
    readonly kinds: readonly ThreadResourceKind<Unit<'machine'>>[];
  }
>()('tagma/threads/ThreadResources') {}
