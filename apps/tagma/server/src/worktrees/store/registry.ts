import type { RequestKey } from '../../platform/contract/wire/ids.js';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { Clock, Effect, Option, Schema } from 'effect';
import type { NamespaceId } from '@runlith/files/namespace';
import { worktree, worktreeOperation } from './tables.js';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { pagesOf } from '../../platform/store/binds.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { RepositoryId } from '../../workspace/contract/wire/repositories.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { branchOf, WorktreeEvidence, WorktreeIntent, type WorktreeRevision } from '../contract/wire/creation.js';
import { WORKTREE_HUES, WorktreeSetupDetail, type WorktreeSetupStatus } from '../contract/wire/rows.js';
import { WorktreeUnavailable } from '../contract/wire/failures.js';
import { ProjectRootMembership, type ReservationHold, type RootReservations } from '../../workspace/contract/service/roots.js';
import type { WorktreeIntents } from '../contract/service/intents.js';
import {
  WorktreeStorageFailed,
  type WorktreeDraft,
  type WorktreeRecord,
  type WorktreeRecords,
  type WorktreeStoreFailure,
} from '../contract/service/worktrees.js';

const HOLD_OWNER = 'worktree';

const HOLD_ADMITS = ['worktree', 'worktree-recovered'] as const;

const decodeOperation = Schema.decodeUnknownEffect(
  Schema.Struct({
    ...WorktreeIntent.fields,
    evidence: Schema.NullOr(Schema.fromJsonString(WorktreeEvidence)),
  }),
);

const modeOf = (row: typeof worktreeOperation.$inferSelect): unknown => {
  if (row.mode === 'existing-branch') return { kind: 'existing-branch', branch: row.branch };
  if (row.mode === 'new-branch') return { kind: 'new-branch', branch: row.branch, start: row.start };
  return { kind: 'detached', start: row.start };
};

const record = Effect.fn('WorktreeStore.record')(
  function* (row: typeof worktreeOperation.$inferSelect) {
    return yield* decodeOperation({
      operationId: row.operationId,
      namespaceId: row.namespaceId,
      projectId: row.projectId,
      repository: { repositoryId: row.repositoryId, locationRevision: row.repositoryRevision },
      destination: row.destination,
      mode: modeOf(row),
      base: row.base,
      payloadDigest: row.payloadDigest,
      status: row.status,
      reserved: row.reserved,
      producer: row.producer,
      rootId: row.rootId,
      evidence: row.evidence,
      abandonment: row.abandonment,
      revision: row.revision,
    });
  },
  (work, row) => Effect.mapError(work, (cause) => new WorktreeStorageFailed({ key: row.operationId, cause })),
);

const decodeDetail = Schema.decodeUnknownOption(Schema.fromJsonString(WorktreeSetupDetail));

const detailOf = (stored: string | null): WorktreeSetupDetail | null => (stored === null ? null : Option.getOrNull(decodeDetail(stored)));

const recordOf = (row: typeof worktree.$inferSelect): WorktreeRecord => ({
  rootId: row.rootId as RootId,
  projectId: row.projectId,
  name: row.name,
  path: row.path,
  branch: row.branch,
  baseBranch: row.baseBranch,
  baseCommit: row.baseCommit,
  origin: row.origin,
  hue: row.hue,
  setup: row.setup,
  setupDetail: detailOf(row.setupDetail),
  taskId: row.taskId,
  createdAt: row.createdAt,
});

const reserving = (namespaceId: NamespaceId, subject: ReturnType<typeof eq> | undefined) =>
  and(
    eq(worktreeOperation.namespaceId, namespaceId),
    sql`${worktreeOperation.reserved} = 1`,
    sql`${worktreeOperation.status} in ('pending', 'uncertain')`,
    isNull(worktreeOperation.abandonment),
    subject,
  );

const valuesOf = (operation: WorktreeIntent): typeof worktreeOperation.$inferInsert => ({
  operationId: operation.operationId,
  namespaceId: operation.namespaceId,
  projectId: operation.projectId,
  repositoryId: operation.repository.repositoryId,
  repositoryRevision: operation.repository.locationRevision,
  destination: operation.destination,
  mode: operation.mode.kind,
  branch: branchOf(operation.mode),
  start: operation.mode.kind === 'existing-branch' ? null : operation.mode.start,
  base: operation.base,
  payloadDigest: operation.payloadDigest,
  status: operation.status,
  reserved: operation.reserved,
  producer: operation.producer,
  rootId: operation.rootId,
  evidence: operation.evidence === null ? null : JSON.stringify(operation.evidence),
  abandonment: operation.abandonment,
  revision: operation.revision,
});

export const storageUnavailable = (error: WorktreeStoreFailure, operationId?: RequestKey): WorktreeUnavailable =>
  new WorktreeUnavailable({ operationId, reason: 'storage', message: error.message });

export type WorktreeStore = WorktreeRecords['Service'] & WorktreeIntents['Service'] & RootReservations['Service'];

export const makeWorktreeStore = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const membership = yield* ProjectRootMembership;
  const store: WorktreeStore = {
    byId: Effect.fn('WorktreeStore.byId')(function* (operationId: RequestKey, tx?: Unit<'machine'>) {
      const query = db.select().from(worktreeOperation).where(eq(worktreeOperation.operationId, operationId)).get();
      const row = yield* tx ? tx.run(query) : query;
      return row ? yield* record(row) : null;
    }),
    holding: Effect.fn('WorktreeStore.holding')(function* (
      namespaceId: NamespaceId,
      paths: readonly string[],
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<ReadonlyMap<string, readonly ReservationHold[]>, StoreFailure> {
      const holds = new Map<string, ReservationHold[]>();
      for (const page of pagesOf(paths, 1, (path) => path.length)) {
        const rows = yield* unit.run(
          db
            .select({ operationId: worktreeOperation.operationId, destination: worktreeOperation.destination })
            .from(worktreeOperation)
            .where(reserving(namespaceId, inArray(worktreeOperation.destination, page)))
            .all(),
        );
        for (const row of rows) {
          const hold = { owner: HOLD_OWNER, holder: row.operationId, admits: HOLD_ADMITS.map((kind) => ({ kind, id: row.operationId })) };
          holds.set(row.destination, [...(holds.get(row.destination) ?? []), hold]);
        }
      }
      return holds;
    }),
    holders: Effect.fn('WorktreeStore.holders')(function* (
      namespaceId: NamespaceId,
      destination: string,
      repositoryId: RepositoryId,
      branch: string | null,
      unit: WriteUnit<'machine'>,
    ) {
      const occupies = eq(worktreeOperation.destination, destination);
      const rows = yield* unit.run(
        db
          .select()
          .from(worktreeOperation)
          .where(
            reserving(
              namespaceId,
              branch === null
                ? occupies
                : or(occupies, and(eq(worktreeOperation.repositoryId, repositoryId), eq(worktreeOperation.branch, branch))),
            ),
          )
          .all(),
      );
      return yield* Effect.forEach(rows, record);
    }),
    insert: Effect.fn('WorktreeStore.insert')(function* (operation: WorktreeIntent, unit: WriteUnit<'machine'>) {
      yield* unit.run(db.insert(worktreeOperation).values(valuesOf(operation)));
      return operation;
    }),
    move: Effect.fn('WorktreeStore.move')(function* (operation: WorktreeIntent, from: WorktreeRevision, unit: WriteUnit<'machine'>) {
      const changed = yield* unit.run(
        db
          .update(worktreeOperation)
          .set({
            base: operation.base,
            status: operation.status,
            reserved: operation.reserved,
            producer: operation.producer,
            rootId: operation.rootId,
            evidence: operation.evidence === null ? null : JSON.stringify(operation.evidence),
            abandonment: operation.abandonment,
            revision: operation.revision,
          })
          .where(and(eq(worktreeOperation.operationId, operation.operationId), eq(worktreeOperation.revision, from)))
          .returning({ operationId: worktreeOperation.operationId })
          .all(),
      );
      return changed.length > 0;
    }),
    record: Effect.fn('WorktreeStore.record')(function* (
      draft: WorktreeDraft,
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<WorktreeRecord, StoreFailure> {
      const standing = yield* unit.run(db.select().from(worktree).where(eq(worktree.rootId, draft.rootId)).get());
      if (standing !== undefined) return recordOf(standing);
      const rows = yield* unit.run(
        db.select({ name: worktree.name, hue: worktree.hue }).from(worktree).where(eq(worktree.projectId, draft.projectId)).all(),
      );
      const names = new Set(rows.map((row) => row.name));
      let name = draft.name;
      for (let suffix = 2; names.has(name); suffix += 1) name = `${draft.name}-${suffix}`;
      const worn = Array.from({ length: WORKTREE_HUES }, () => 0);
      for (const row of rows) {
        if (row.hue >= 0 && row.hue < WORKTREE_HUES) worn[row.hue] = (worn[row.hue] ?? 0) + 1;
      }
      const hue = worn.indexOf(Math.min(...worn));
      const values = {
        rootId: draft.rootId,
        projectId: draft.projectId,
        name,
        path: draft.path,
        branch: draft.branch,
        baseBranch: draft.baseBranch,
        baseCommit: draft.baseCommit,
        hue,
        origin: draft.origin,
        setup: 'pending' as const,
        setupDetail: null,
        taskId: null,
        namedBy: null,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      };
      yield* unit.run(db.insert(worktree).values(values));
      yield* membership.link(draft.projectId, draft.rootId, unit);
      return recordOf(values);
    }),
    records: Effect.fn('WorktreeStore.records')(function* (
      projectId: number,
      unit: Unit<'machine'>,
    ): Effect.fn.Return<readonly WorktreeRecord[], StoreFailure> {
      const rows = yield* unit.run(db.select().from(worktree).where(eq(worktree.projectId, projectId)).all());
      return rows.map(recordOf);
    }),
    recordedRoots: Effect.fn('WorktreeStore.recordedRoots')(function* (
      projectId: number,
      unit: Unit<'machine'>,
    ): Effect.fn.Return<readonly RootId[], StoreFailure> {
      const rows = yield* unit.run(db.select({ rootId: worktree.rootId }).from(worktree).where(eq(worktree.projectId, projectId)).all());
      return rows.map((row) => row.rootId as RootId);
    }),
    byRoot: Effect.fn('WorktreeStore.byRoot')(function* (
      rootId: RootId,
      unit: Unit<'machine'>,
    ): Effect.fn.Return<WorktreeRecord | null, StoreFailure> {
      const row = yield* unit.run(db.select().from(worktree).where(eq(worktree.rootId, rootId)).get());
      return row === undefined ? null : recordOf(row);
    }),
    unsettled: Effect.fn('WorktreeStore.unsettled')(function* (
      unit: Unit<'machine'>,
    ): Effect.fn.Return<readonly WorktreeRecord[], StoreFailure> {
      const rows = yield* unit.run(
        db
          .select()
          .from(worktree)
          .where(inArray(worktree.setup, ['pending', 'running']))
          .all(),
      );
      return rows.map(recordOf);
    }),
    settle: Effect.fn('WorktreeStore.settle')(function* (
      rootId: RootId,
      from: WorktreeSetupStatus,
      to: WorktreeSetupStatus,
      detail: WorktreeSetupDetail | null,
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<boolean, StoreFailure> {
      const changed = yield* unit.run(
        db
          .update(worktree)
          .set({ setup: to, setupDetail: detail === null ? null : JSON.stringify(detail) })
          .where(and(eq(worktree.rootId, rootId), eq(worktree.setup, from)))
          .returning({ rootId: worktree.rootId })
          .all(),
      );
      return changed.length > 0;
    }),
    drop: Effect.fn('WorktreeStore.drop')(function* (rootId: RootId, unit: WriteUnit<'machine'>): Effect.fn.Return<boolean, StoreFailure> {
      const changed = yield* unit.run(
        db.delete(worktree).where(eq(worktree.rootId, rootId)).returning({ rootId: worktree.rootId, projectId: worktree.projectId }).all(),
      );
      for (const row of changed) yield* membership.unlink(row.projectId, row.rootId as RootId, unit);
      return changed.length > 0;
    }),
    nameAfter: Effect.fn('WorktreeStore.nameAfter')(function* (
      rootId: RootId,
      threadId: string,
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<boolean, StoreFailure> {
      const changed = yield* unit.run(
        db.update(worktree).set({ namedBy: threadId }).where(eq(worktree.rootId, rootId)).returning({ rootId: worktree.rootId }).all(),
      );
      return changed.length > 0;
    }),
    namedAfter: Effect.fn('WorktreeStore.namedAfter')(function* (
      threadId: string,
      unit: Unit<'machine'>,
    ): Effect.fn.Return<WorktreeRecord | null, StoreFailure> {
      const row = yield* unit.run(db.select().from(worktree).where(eq(worktree.namedBy, threadId)).get());
      return row === undefined ? null : recordOf(row);
    }),
    renamed: Effect.fn('WorktreeStore.renamed')(function* (
      rootId: RootId,
      from: string,
      to: string,
      unit: WriteUnit<'machine'>,
      threadId?: string,
    ): Effect.fn.Return<boolean, StoreFailure> {
      const changed = yield* unit.run(
        db
          .update(worktree)
          .set({ branch: to, namedBy: null })
          .where(
            and(
              eq(worktree.rootId, rootId),
              eq(worktree.branch, from),
              threadId === undefined ? undefined : eq(worktree.namedBy, threadId),
            ),
          )
          .returning({ rootId: worktree.rootId })
          .all(),
      );
      return changed.length > 0;
    }),
    unnamed: Effect.fn('WorktreeStore.unnamed')(function* (
      rootId: RootId,
      threadId: string,
      unit: WriteUnit<'machine'>,
    ): Effect.fn.Return<void, StoreFailure> {
      yield* unit.run(
        db
          .update(worktree)
          .set({ namedBy: null })
          .where(and(eq(worktree.rootId, rootId), eq(worktree.namedBy, threadId))),
      );
    }),
    liveProjects: Effect.fn('WorktreeStore.liveProjects')(function* (
      unit: Unit<'machine'>,
    ): Effect.fn.Return<readonly number[], StoreFailure> {
      const rows = yield* unit.run(db.selectDistinct({ projectId: worktree.projectId }).from(worktree).all());
      return rows.map((row) => row.projectId);
    }),
  };
  return store;
});
