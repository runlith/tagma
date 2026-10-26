import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Data, Effect, Schema } from 'effect';
import { assignmentMembership, assignmentSelection } from './tables.js';
import type { StoreDb, StoreFailure } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { AssignmentRefused, Membership, RootSelection, SelectionRevision, type SelectionProvenance } from '../contract/wire/assignments.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { RootId } from '../contract/wire/ids.js';

export class AssignmentStorageFailed extends Data.TaggedError('AssignmentStorageFailed')<{
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Assignment record ${this.key} cannot be read: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

export type AssignmentStoreFailure = StoreFailure | AssignmentStorageFailed;

const decodeMembership = Schema.decodeUnknownEffect(Membership);
const decodeSelection = Schema.decodeUnknownEffect(RootSelection);

const INTRINSIC: RootSelection = {
  rootId: null,
  provenance: 'intrinsic',
  revision: SelectionRevision.make(0),
};

export type AssignmentStore = ReturnType<typeof makeAssignmentStore>;

export const makeAssignmentStore = ({ db }: { readonly db: StoreDb<'machine'> }) => {
  const assignment = Effect.fn('AssignmentStore.assignment')(function* (threadId: ThreadId, unit: Unit<'machine'>) {
    const rows = yield* unit.run(
      db.all<{
        kind: string;
        root_id: string | null;
        provenance: string;
        revision: number | null;
      }>(sql`
      select 'membership' as kind, ${assignmentMembership.rootId} as root_id,
             ${assignmentMembership.provenance} as provenance, null as revision
        from ${assignmentMembership} where ${assignmentMembership.threadId} = ${threadId}
      union all
      select 'selection', ${assignmentSelection.rootId}, ${assignmentSelection.provenance},
             ${assignmentSelection.revision}
        from ${assignmentSelection} where ${assignmentSelection.threadId} = ${threadId}
      order by kind, root_id
    `),
    );
    const selected = rows.find((row) => row.kind === 'selection');
    return {
      memberships: yield* records(
        rows.flatMap((row) =>
          row.kind === 'membership' && row.root_id !== null ? [{ threadId, rootId: row.root_id, provenance: row.provenance }] : [],
        ),
      ),
      selection: selected === undefined ? INTRINSIC : yield* selectedStep(threadId, selected),
    };
  });

  const selectionStep = Effect.fn('AssignmentStore.selection')(function* (threadId: ThreadId, unit: Unit<'machine'>) {
    const row = yield* unit.run(db.select().from(assignmentSelection).where(eq(assignmentSelection.threadId, threadId)).get());
    return row === undefined
      ? INTRINSIC
      : yield* selectedStep(threadId, { root_id: row.rootId, provenance: row.provenance, revision: row.revision });
  });

  const holders = Effect.fn('AssignmentStore.holders')(function* (rootIds: readonly RootId[], unit: Unit<'machine'>) {
    if (rootIds.length === 0) return [];
    const rows = yield* unit.run(
      db
        .select()
        .from(assignmentMembership)
        .where(inArray(assignmentMembership.rootId, rootIds))
        .orderBy(asc(assignmentMembership.rootId), asc(assignmentMembership.threadId))
        .all(),
    );
    return yield* records(rows);
  });

  const enroll = Effect.fn('AssignmentStore.enroll')(function* (
    membership: Membership,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    yield* unit.run(
      db
        .insert(assignmentMembership)
        .values({
          threadId: membership.threadId,
          rootId: membership.rootId,
          provenance: membership.provenance,
        })
        .onConflictDoNothing(),
    );
  });

  const withdraw = Effect.fn('AssignmentStore.withdraw')(function* (
    threadId: ThreadId,
    rootId: RootId,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, StoreFailure> {
    yield* unit.run(
      db.delete(assignmentMembership).where(and(eq(assignmentMembership.threadId, threadId), eq(assignmentMembership.rootId, rootId))),
    );
  });

  const select = Effect.fn('AssignmentStore.select')(function* (
    threadId: ThreadId,
    rootId: RootId | null,
    provenance: SelectionProvenance,
    unit: WriteUnit<'machine'>,
  ): Effect.fn.Return<void, AssignmentStoreFailure | AssignmentRefused> {
    const standing = yield* selectionStep(threadId, unit);
    if (standing.revision === Number.MAX_SAFE_INTEGER) {
      return yield* new AssignmentRefused({
        threadId,
        reason: 'revision-exhausted',
        message: 'The selection revision counter of this thread is exhausted.',
      });
    }
    const revision = SelectionRevision.make(standing.revision + 1);
    yield* unit.run(
      db.insert(assignmentSelection).values({ threadId, rootId, provenance, revision }).onConflictDoUpdate({
        target: assignmentSelection.threadId,
        set: { rootId, provenance, revision },
      }),
    );
  });

  const selectedStep = Effect.fn('AssignmentStore.selected')(
    (threadId: ThreadId, row: { root_id: string | null; provenance: string; revision: number | null }) =>
      decodeSelection({
        rootId: row.root_id,
        provenance: row.provenance,
        revision: row.revision,
      }).pipe(Effect.mapError((cause) => new AssignmentStorageFailed({ key: threadId, cause }))),
  );

  const records = Effect.fn('AssignmentStore.records')((rows: readonly { threadId: string; rootId: string; provenance: string }[]) =>
    Effect.forEach(rows, (row) =>
      decodeMembership(row).pipe(Effect.mapError((cause) => new AssignmentStorageFailed({ key: `${row.threadId}/${row.rootId}`, cause }))),
    ),
  );

  return { assignment, selection: selectionStep, holders, enroll, withdraw, select };
};
