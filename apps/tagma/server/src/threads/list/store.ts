import type { ThreadMetadataRow } from '@runlith/agent/thread/rows';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, not, or, sql, type SQL } from 'drizzle-orm';
import { Clock, Effect } from 'effect';
import type { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type Unit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { thread, threadRun, threadRunTally } from '../store/kernel.js';
import { recordRows, threadRecord } from '../../thread-record/store/table.js';
import { seenRows, threadSeen } from '../store/tables.js';
import { threadMandate } from '../store/mandate.js';
import { assignmentSelection } from '../../workspace/store/tables.js';
import { lineageOf, subtreeOf } from '../../thread-record/lineage.js';
import { recordFacts } from '../../thread-record/facts.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { restedAtOf } from '../rest.js';
import { sessionOf } from '../store/harnessFacet.js';
import type { HarnessId } from '../../platform/contract/wire/session.js';
import { workingThreads } from './working.js';
import { makeThreadSelections } from './active.js';
import { parseExternalSession, type ExternalSession } from '../contract/wire/harness/externalSession.js';
import { trusted } from '../../platform/store/crossing.js';
import { among } from '../../platform/store/rows.js';
import { ThreadMetadataSource } from '../contract/service/parts.js';
import type { ThreadLookup, ThreadPlaces, ThreadReading, ThreadRunning, ThreadShelving, ThreadWindows } from '../contract/service/reads.js';
import { ThreadInputRefused } from '../contract/service/failure.js';
import type { ArchiveWork } from '../contract/service/list.js';
import { standingDriven, standingOf } from '../events/standing.js';
import { OwnWork } from '../contract/service/ownWork.js';
import { endSubscriptions, threadSubscription } from '../store/subscriptions.js';
import { moveOf, summaryOf, type SummaryRow, type ThreadSummary } from './summary.js';
import {
  activeSessions,
  heldSessions,
  heldUp,
  pinnedRoots,
  runningRoots,
  liveFamilyOf,
  liveRoot,
  outcomeRunOf,
  pastCursor,
  pulseDriven,
  rootsOf,
  selected,
  summariesOf,
  type ThreadSelection,
} from './select.js';

export type ThreadMetadata = ThreadMetadataRow & {
  readonly projectId: number;
  readonly scopeBlockUuid: string | null;
  readonly harness: ExternalSession | null;
  readonly archivedAt?: Date | null;
};

export type SubtreeMember = {
  readonly id: string;
  readonly projectId: number | null;
  readonly harness: ExternalSession | null;
  readonly host: { readonly kind: string; readonly id: string } | null;
};

export type PlacedEntry = {
  readonly threadId: string;
  readonly parentThreadId: string | null;
  readonly createdAt: Date;
  readonly archivedAt: Date | null;
};

export type ThreadGate = {
  readonly projectId: number;
  readonly evictedAt: Date | null;
};

const matchedWhere = (ownerId: string, homes: readonly number[], selection: ThreadSelection, spared: string | null) =>
  and(selected(ownerId, homes, selection), spared === null ? undefined : sql`${recordFacts.id} not in ${lineageOf(spared)}`);

export type ThreadListReads = ThreadLookup['Service'] &
  ThreadWindows['Service'] &
  ThreadRunning['Service'] &
  ThreadPlaces['Service'] &
  ThreadShelving['Service'] &
  ThreadReading['Service'];

export const makeThreadListReads = Effect.gen(function* () {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const threads = yield* ThreadMetadataSource;
  const records = yield* ThreadRecords;
  const kinds = yield* ThreadEntryKinds;
  const own = yield* OwnWork;
  const selections = yield* makeThreadSelections;

  const summarized = Effect.fnUntraced(function* (call: string, rows: readonly SummaryRow[]) {
    const now = new Date(yield* Clock.currentTimeMillis);
    return yield* trusted(call, () => rows.map((row) => summaryOf(kinds, row, true, now)));
  });

  const owingOf = (ids?: readonly string[]) => Effect.map(own.owing(ids), (owing): ReadonlySet<string> => new Set(owing));

  const marked = <Row extends ThreadSummary>(owing: ReadonlySet<string>, rows: readonly Row[]): readonly Row[] =>
    owing.size === 0 ? rows : rows.map((row) => (row.activeRun === null && owing.has(row.id) ? { ...row, owes: true } : row));

  const markedOne = (
    ids: readonly string[],
    read: Effect.Effect<ThreadSummary | undefined, StoreFailure | ThreadStorageFailed>,
  ): Effect.Effect<ThreadSummary | undefined, StoreFailure | ThreadStorageFailed> =>
    Effect.flatMap(owingOf(ids), (owing) => Effect.map(read, (row) => (row === undefined ? undefined : marked(owing, [row])[0])));

  const summaryIn = (unit: Unit<'machine'>, call: string, threadId: string) =>
    Effect.flatMap(unit.run(summariesOf(db, eq(recordFacts.id, threadId)).get()), (row) =>
      row === undefined ? Effect.succeed(undefined) : Effect.map(summarized(call, [row]), (summaries) => summaries[0]),
    );

  const placeOf = (unit: Unit<'machine'>, id: string) =>
    Effect.map(
      unit.run(
        db
          .select({
            projectId: recordFacts.projectId,
            scopeBlockUuid: recordFacts.scopeBlockUuid,
            archivedAt: recordFacts.archivedAt,
            harness: sessionOf(recordFacts.id),
          })
          .from(recordFacts)
          .where(and(eq(recordFacts.id, id), isNotNull(recordFacts.projectId)))
          .get(),
      ),
      (row) =>
        row === undefined || row.projectId === null
          ? undefined
          : {
              projectId: row.projectId,
              scopeBlockUuid: row.scopeBlockUuid,
              archivedAt: row.archivedAt,
              harness: parseExternalSession(row.harness),
            },
    );

  const archive = (ids: readonly string[], at: Date | null, call: string) =>
    units.write(writes(call, [recordRows, threadSubscription]), (unit) =>
      Effect.tap(records.setArchived(unit, ids, at), (moved) => (at === null ? Effect.void : endSubscriptions(db, unit, moved))),
    );

  const windowOf = Effect.fnUntraced(function* (
    unit: Unit<'machine'>,
    ownerId: string,
    homes: readonly number[],
    page: { readonly limit: number; readonly before?: Date },
    owing: ReadonlySet<string>,
  ) {
    const roots = and(selected(ownerId, homes, { view: 'live' }), liveRoot(ownerId, homes));
    const cut = page.before === undefined ? roots : and(roots, sql`${recordFacts.readerOrderAt} < ${page.before.getTime()}`);
    const working = yield* unit.run(
      db
        .select({ id: recordFacts.id })
        .from(recordFacts)
        .where(
          and(
            roots,
            or(
              sql`${recordFacts.id} in ${runningRoots(ownerId, homes)}`,
              owing.size === 0 ? undefined : sql`${recordFacts.id} in ${rootsOf(ownerId, homes, [...owing])}`,
            ),
          ),
        ),
    );
    const workingIds = working.map((row) => row.id);
    const pinned = yield* unit.run(
      db
        .select({ id: recordFacts.id })
        .from(recordFacts)
        .where(
          and(
            roots,
            or(isNotNull(recordFacts.pinnedAt), isNotNull(recordFacts.folderId), sql`${recordFacts.id} in ${pinnedRoots(ownerId, homes)}`),
          ),
        ),
    );
    const heldIds = [...new Set([...workingIds, ...pinned.map((row) => row.id)])];
    const idleLimit = Math.max(1, page.limit - workingIds.length);
    const idleCut = heldIds.length === 0 ? cut : and(cut, not(inArray(recordFacts.id, heldIds)));
    const newest = yield* unit.run(
      db
        .select({ id: recordFacts.id, readerOrderAt: recordFacts.readerOrderAt })
        .from(recordFacts)
        .where(idleCut)
        .orderBy(desc(recordFacts.readerOrderAt), desc(recordFacts.id))
        .limit(idleLimit + 1),
    );
    const idle = newest.slice(0, idleLimit);
    const counted = yield* unit.run(db.select({ total: count() }).from(recordFacts).where(roots).get());
    const admitted = [...heldIds, ...idle.map((row) => row.id)];
    const last = idle.at(-1);
    return {
      admitted: sql`${recordFacts.id} in ${liveFamilyOf(ownerId, admitted)}`,
      roots: counted?.total ?? 0,
      windowBefore: last === undefined || newest.length <= idleLimit ? null : last.readerOrderAt,
    };
  });

  const runningRun = (threadId: string, unit: Unit<'machine'>) =>
    Effect.map(
      unit.run(
        db
          .select({ runId: sql<string>`id` })
          .from(activeSessions)
          .where(sql`thread_id = ${threadId}`)
          .get(),
      ),
      (row) => row?.runId ?? null,
    );

  const reads: ThreadListReads = {
    find: (id, ownerId, unit) => {
      const read = Effect.fnUntraced(function* (tx: Unit<'machine'>) {
        const facet = yield* placeOf(tx, id);
        if (!facet) return undefined;
        const row = yield* threads.metadata(id, tx);
        return row && row.ownerId === ownerId
          ? {
              ...row,
              projectId: facet.projectId,
              scopeBlockUuid: facet.scopeBlockUuid,
              harness: facet.harness,
              archivedAt: facet.archivedAt,
            }
          : undefined;
      });
      return unit === undefined ? units.read(read) : read(unit);
    },

    summary: (threadId) =>
      markedOne(
        [threadId],
        units.read((unit) => summaryIn(unit, 'summary', threadId)),
      ),

    summaries: (ids) =>
      ids.length === 0
        ? Effect.succeed([])
        : Effect.flatMap(owingOf(ids), (owing) =>
            Effect.map(
              units.read((unit) =>
                Effect.flatMap(unit.run(summariesOf(db, inArray(recordFacts.id, among(ids)))), (rows) => summarized('summaries', rows)),
              ),
              (rows) => marked(owing, rows),
            ),
          ),

    list: (ownerId, homes, selection) => {
      if (selection.active !== undefined)
        return Effect.gen(function* () {
          const reading = yield* selections.pin(ownerId, homes, selection);
          const page = yield* selections.page(ownerId, homes.id, reading, 0, selection.limit ?? -1);
          const { active: _active, ...metadata } = selection;
          const listed = yield* reads.list(ownerId, homes, { ...metadata, ids: page.ids });
          return { ...listed, total: page.total };
        });
      if (selection.view === 'live' && selection.archivedAt !== undefined) {
        return Effect.die(
          new ThreadInputRefused('selection-shape', 'A range on archivedAt narrows the archived set; the live set carries no such clock.', [
            'name the archived set: archived=true',
            'name both sets: set=all',
            'drop the archivedAt range',
          ]),
        );
      }
      const clock = selection.view === 'archived' ? recordFacts.archivedAt : recordFacts.readerOrderAt;
      const counting = selected(ownerId, homes.projects, selection);
      const where = and(counting, pastCursor(clock, selection.before));
      const page = units.read((unit) =>
        Effect.gen(function* () {
          let page = summariesOf(db, where).orderBy(desc(clock), desc(recordFacts.id)).$dynamic();
          if (selection.limit !== undefined) page = page.limit(selection.limit);
          const rows = yield* unit.run(page);
          const counted = yield* unit.run(
            db.select({ total: count() }).from(recordFacts).leftJoin(thread, eq(thread.id, recordFacts.id)).where(counting).get(),
          );
          const summaries = yield* summarized('list', rows);
          const last = summaries.at(-1);
          const more = selection.limit !== undefined && summaries.length === selection.limit;
          return {
            rows: summaries,
            total: counted?.total ?? 0,
            before:
              !more || last === undefined
                ? null
                : {
                    orderAt: selection.view === 'archived' ? (last.archivedAt ?? last.readerOrderAt) : last.readerOrderAt,
                    id: last.id,
                  },
          };
        }),
      );
      return Effect.flatMap(owingOf(), (owing) => Effect.map(page, (read) => ({ ...read, rows: marked(owing, read.rows) })));
    },

    attention: (ownerId) =>
      Effect.flatMap(owingOf(), (owing) =>
        Effect.map(
          units.read((unit) =>
            Effect.flatMap(
              unit.run(summariesOf(db, and(sql`+${recordFacts.principalId} = ${ownerId}`, isNull(recordFacts.archivedAt), standingDriven))),
              (rows) => summarized('attention', rows),
            ),
          ),
          (summaries) => marked(owing, summaries).filter((row) => standingOf(row) !== null),
        ),
      ),

    pulse: (ownerId) =>
      Effect.flatMap(owingOf(), (owing) =>
        Effect.map(
          units.read((unit) =>
            Effect.flatMap(
              unit.run(summariesOf(db, and(sql`+${recordFacts.principalId} = ${ownerId}`, isNull(recordFacts.archivedAt), pulseDriven))),
              (rows) => summarized('pulse', rows),
            ),
          ),
          (summaries) => marked(owing, summaries),
        ),
      ),

    pin: selections.pin,
    page: selections.page,

    rootIds: Effect.fn('ThreadListReads.rootIds')(function* (
      ownerId: string,
      homes: readonly number[],
      page: { readonly limit: number; readonly before?: Date },
    ) {
      yield* Effect.annotateCurrentSpan({ projects: homes.join(','), limit: page.limit });
      const owing = yield* owingOf();
      return yield* units.read((unit) =>
        Effect.gen(function* () {
          const window = yield* windowOf(unit, ownerId, homes, page, owing);
          const ids = yield* unit.run(
            db
              .select({ id: recordFacts.id })
              .from(recordFacts)
              .where(window.admitted)
              .orderBy(desc(recordFacts.readerOrderAt), desc(recordFacts.id)),
          );
          return { ids: ids.map((row) => row.id), roots: window.roots, windowBefore: window.windowBefore };
        }),
      );
    }),

    rootWindow: Effect.fn('ThreadListReads.rootWindow')(function* (
      ownerId: string,
      homes: readonly number[],
      page: { readonly limit: number; readonly before?: Date },
    ) {
      yield* Effect.annotateCurrentSpan({ projects: homes.join(','), limit: page.limit });
      const owing = yield* owingOf();
      const window = yield* units.read((unit) =>
        Effect.gen(function* () {
          const held = yield* windowOf(unit, ownerId, homes, page, owing);
          const rows = yield* unit.run(summariesOf(db, held.admitted).orderBy(desc(recordFacts.readerOrderAt), desc(recordFacts.id)));
          return { rows: yield* summarized('rootWindow', rows), roots: held.roots, windowBefore: held.windowBefore };
        }),
      );
      return { ...window, rows: marked(owing, window.rows) };
    }),

    families: (ownerId, member, lists) =>
      lists.length === 0
        ? Effect.succeed([])
        : Effect.flatMap(owingOf(), (owing) =>
            Effect.map(
              units.read((unit) =>
                Effect.gen(function* () {
                  const roots = yield* Effect.forEach(lists, (list) =>
                    Effect.map(
                      unit.run(
                        db
                          .select({ id: recordFacts.id })
                          .from(recordFacts)
                          .where(
                            and(
                              eq(recordFacts.principalId, ownerId),
                              isNull(recordFacts.archivedAt),
                              inArray(recordFacts.projectId, [...list.projects]),
                              sql`${recordFacts.id} in ${lineageOf(member.id)}`,
                              liveRoot(ownerId, list.projects),
                            ),
                          ),
                      ),
                      (found) => found.map((root) => ({ id: root.id, listId: list.id })),
                    ),
                  );
                  return yield* Effect.forEach(roots.flat(), (root) =>
                    Effect.gen(function* () {
                      const rows = yield* unit.run(
                        summariesOf(
                          db,
                          and(sql`${recordFacts.id} in ${liveFamilyOf(ownerId, [root.id])}`, sql`${recordFacts.id} != ${member.id}`),
                        ),
                      );
                      return { listId: root.listId, rows: [member, ...(yield* summarized('families', rows))] };
                    }),
                  );
                }),
              ),
              (families) => families.map((family) => ({ ...family, rows: marked(owing, family.rows) })),
            ),
          ),

    setArchived: (threadId, at) => archive([threadId], at, 'ThreadListReads.setArchived'),

    setPinned: (threadId, at) =>
      units.write(writes('ThreadListReads.setPinned', [recordRows]), (unit) => records.setPinned(unit, threadId, at)),

    heldUpMatching: (ownerId, homes, selection, spared) =>
      units.read((unit) =>
        unit.run(
          db
            .select({
              threadId: recordFacts.id,
              runId: sql<string>`held.run_id`,
              kind: sql<'run' | 'harness'>`held.kind`,
              sessionThreadId: sql<string>`held.session_thread`,
              harness: sql<HarnessId>`held.harness`,
            })
            .from(recordFacts)
            .leftJoin(thread, eq(thread.id, recordFacts.id))
            .innerJoin(sql`${heldUp} held`, sql`held.id = ${recordFacts.id}`)
            .where(matchedWhere(ownerId, homes, selection, spared)),
        ),
      ),

    selectsBeyond: (ownerId, homes, selection, callerId) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: recordFacts.id })
              .from(recordFacts)
              .leftJoin(thread, eq(thread.id, recordFacts.id))
              .where(
                and(
                  selected(ownerId, homes, selection),
                  sql`${recordFacts.id} not in ${lineageOf(callerId)}`,
                  sql`${recordFacts.id} not in ${subtreeOf(callerId)}`,
                ),
              )
              .limit(1)
              .get(),
          ),
          (row) => row !== undefined,
        ),
      ),

    setArchivedWhere: Effect.fnUntraced(function* (
      ownerId: string,
      homes: readonly number[],
      selection: ThreadSelection,
      at: Date | null,
      spared: string | null,
      before?: ArchiveWork,
    ) {
      const matched = matchedWhere(ownerId, homes, selection, spared);
      const chosen = (rootsWithin?: readonly string[]) =>
        units.read((unit) =>
          Effect.gen(function* () {
            const rows = yield* unit.run(
              db
                .select({ id: recordFacts.id, runId: sql<string | null>`held.run_id` })
                .from(recordFacts)
                .leftJoin(thread, eq(thread.id, recordFacts.id))
                .leftJoin(sql`${heldUp} held`, sql`held.id = ${recordFacts.id} and held.kind = 'run'`)
                .where(matched),
            );
            const admitted = rootsWithin === undefined ? null : new Set(rootsWithin);
            const ids = rows.filter((row) => row.runId === null && (admitted === null || admitted.has(row.id))).map((row) => row.id);
            const working = rows.flatMap((row) => (row.runId === null ? [] : [{ threadId: row.id, runId: row.runId }]));
            const members =
              before === undefined || ids.length === 0
                ? []
                : yield* unit.run(
                    db.select({ id: recordFacts.id }).from(recordFacts).where(sql`${recordFacts.id} in (
            with recursive family(id) as (
              select value from json_each(${JSON.stringify(ids)})
              union
              select r.id from ${threadRecord} r join family f on r.parent_id = f.id
            ) select id from family
          )`),
                  );
            return { ids, members: members.map((row) => row.id), working };
          }),
        );
      const stamp = (ids: readonly string[]) => archive(ids, at, 'ThreadListReads.setArchivedWhere');
      const targets = yield* chosen();
      if (before === undefined || targets.members.length === 0) return { moved: yield* stamp(targets.ids), working: targets.working };
      return yield* before(targets.members, (close) =>
        Effect.gen(function* () {
          const fresh = yield* chosen(targets.ids);
          yield* close(fresh.members);
          return { moved: yield* stamp(fresh.ids), working: fresh.working };
        }),
      );
    }),

    activeRunInSubtree: (threadId) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ runId: sql<string>`id`, threadId: sql<string>`thread_id` })
              .from(activeSessions)
              .where(sql`thread_id in ${subtreeOf(threadId)}`)
              .get(),
          ),
          (row) => row ?? null,
        ),
      ),

    working: workingThreads(db, units),

    heldSessionsInSubtree: (threadId) =>
      units.read((unit) =>
        unit.run(
          db
            .select({
              runId: sql<string>`id`,
              threadId: sql<string>`thread_id`,
              kind: sql<'run' | 'harness'>`kind`,
              harness: sql<HarnessId>`harness`,
            })
            .from(heldSessions)
            .where(sql`thread_id in ${subtreeOf(threadId)}`)
            .all(),
        ),
      ),

    heldSessionsIn: (projectId) =>
      units.read((unit) =>
        unit.run(
          db
            .select({
              runId: sql<string>`id`,
              threadId: sql<string>`thread_id`,
              kind: sql<'run' | 'harness'>`kind`,
              harness: sql<HarnessId>`harness`,
            })
            .from(heldSessions)
            .where(sql`thread_id in (select ${threadRecord.id} from ${threadRecord} where ${threadRecord.projectId} = ${projectId})`)
            .all(),
        ),
      ),

    runningRunOf: (threadId) => units.read((unit) => runningRun(threadId, unit)),

    runningRun,

    standings: (projectId, threadIds) =>
      threadIds !== undefined && threadIds.length === 0
        ? Effect.succeed([])
        : units.read((unit) =>
            Effect.map(
              unit.run(
                db
                  .select({
                    threadId: recordFacts.id,
                    updatedAt: thread.updatedAt,
                    clock: recordFacts.movedAt,
                    createdAt: recordFacts.createdAt,
                    runId: threadRun.id,
                    progress: threadRun.progress,
                    outcomeRunId: outcomeRunOf(recordFacts.id),
                    seenRunId: threadSeen.runId,
                    rootId: assignmentSelection.rootId,
                    provenance: assignmentSelection.provenance,
                  })
                  .from(recordFacts)
                  .leftJoin(thread, eq(thread.id, recordFacts.id))
                  .leftJoin(threadRun, and(eq(threadRun.threadId, recordFacts.id), eq(threadRun.status, 'running')))
                  .leftJoin(threadSeen, eq(threadSeen.threadId, recordFacts.id))
                  .leftJoin(assignmentSelection, eq(assignmentSelection.threadId, recordFacts.id))
                  .where(
                    and(
                      eq(recordFacts.projectId, projectId),
                      isNull(recordFacts.archivedAt),
                      threadIds === undefined ? undefined : inArray(recordFacts.id, [...threadIds]),
                    ),
                  )
                  .all(),
              ),
              (rows) => rows.map((row) => moveOf({ ...row, updatedAt: row.updatedAt ?? row.clock ?? row.createdAt })),
            ),
          ),

    placedIn: (projectId, rootId) =>
      units.read((unit) =>
        unit.run(
          db
            .select({
              threadId: recordFacts.id,
              parentThreadId: recordFacts.parentId,
              createdAt: recordFacts.createdAt,
              archivedAt: recordFacts.archivedAt,
            })
            .from(assignmentSelection)
            .innerJoin(recordFacts, eq(recordFacts.id, assignmentSelection.threadId))
            .where(and(eq(recordFacts.projectId, projectId), eq(assignmentSelection.rootId, rootId)))
            .all(),
        ),
      ),

    restingProjects: () =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .selectDistinct({ projectId: recordFacts.projectId })
              .from(recordFacts)
              .where(isNull(restedAtOf(recordFacts.id))),
          ),
          (rows) => rows.flatMap((row) => (row.projectId === null ? [] : [row.projectId])),
        ),
      ),

    restingPast: (projectId, before) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ id: recordFacts.id })
              .from(recordFacts)
              .leftJoin(thread, eq(thread.id, recordFacts.id))
              .where(
                and(
                  eq(recordFacts.projectId, projectId),
                  sql`coalesce(${thread.updatedAt}, ${recordFacts.movedAt}) < ${before.getTime()}`,
                  isNull(restedAtOf(recordFacts.id)),
                  sql`${recordFacts.id} not in (select id from ${heldUp})`,
                ),
              )
              .orderBy(sql`coalesce(${thread.updatedAt}, ${recordFacts.movedAt}) asc, ${recordFacts.id} asc`),
          ),
          (rows) => rows.map((row) => row.id),
        ),
      ),

    see: (threadId, runId) =>
      markedOne(
        [threadId],
        units.write(writes('ThreadListReads.see', [seenRows, threadRunTally]), (unit) =>
          Effect.gen(function* () {
            const read = summaryIn(unit, 'see', threadId);
            const before = yield* read;
            if (before?.outcome?.runId !== runId) return before;
            yield* unit.run(
              db.insert(threadSeen).values({ threadId, runId }).onConflictDoUpdate({ target: threadSeen.threadId, set: { runId } }),
            );
            yield* unit.run(db.update(threadRunTally).set({ unseen: false }).where(eq(threadRunTally.threadId, threadId)));
            return yield* read;
          }),
        ),
      ),

    gateFacet: (id) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({ projectId: recordFacts.projectId, evictedAt: restedAtOf(recordFacts.id) })
              .from(recordFacts)
              .where(and(eq(recordFacts.id, id), isNotNull(recordFacts.projectId)))
              .get(),
          ),
          (row) => (row === undefined || row.projectId === null ? undefined : { projectId: row.projectId, evictedAt: row.evictedAt }),
        ),
      ),

    advanceReaderOrder: Effect.fn('ThreadListReads.advanceReaderOrder')(function* (threadId, at) {
      const when = at ?? new Date(yield* Clock.currentTimeMillis);
      yield* units.write(writes('ThreadListReads.advanceReaderOrder', [recordRows]), (unit) =>
        records.advanceReaderOrder(unit, threadId, when),
      );
    }),

    subtree: (threadId) =>
      units.read((unit) =>
        Effect.map(
          unit.run(
            db
              .select({
                id: recordFacts.id,
                projectId: recordFacts.projectId,
                harness: sessionOf(recordFacts.id),
                hostKind: threadMandate.hostKind,
                hostId: threadMandate.hostId,
              })
              .from(recordFacts)
              .leftJoin(threadMandate, eq(threadMandate.id, recordFacts.id))
              .where(sql`${recordFacts.id} in ${subtreeOf(threadId)}`),
          ),
          (rows) =>
            rows.map((row) => ({
              id: row.id,
              projectId: row.projectId,
              harness: parseExternalSession(row.harness),
              host: row.hostKind !== null && row.hostId !== null ? { kind: row.hostKind, id: row.hostId } : null,
            })),
        ),
      ),
  };
  return reads;
});
