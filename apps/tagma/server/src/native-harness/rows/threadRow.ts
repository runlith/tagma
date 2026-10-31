import { Clock, Effect } from 'effect';
import { type ThreadHistory, type ThreadMetadataRow, THREAD_AUTHORITY_DEFAULT } from '@runlith/agent/thread/rows';
import type { ThreadTranscript } from '@runlith/agent/transcript/rows';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import {
  ThreadNotFoundError,
  type ThreadInsertValues,
  type ThreadPatch,
  type ThreadTeamAsk,
  type ThreadTranscriptQuery,
} from '@runlith/agent/thread/storage/aggregate';
import { and, asc, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { MachineStore } from '../../platform/contract/service/store.js';
import { NATIVE_HARNESS } from '../../platform/contract/wire/session.js';
import { type Unit, MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { thread, threadRun } from '../../threads/store/kernel.js';
import { ThreadRecords } from '../../thread-record/contract/service/records.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { subtreeOf } from '../../thread-record/lineage.js';
import { metadataColumns, rowColumns, threadRow } from '../row.js';
import { makeFoldWriter } from '../transcript/foldWrite.js';
import type { RestedFolds } from '../transcript/restedFolds.js';
import { ThreadEntryKinds } from '@runlith/agent/transcript/kinds';
import { inProgram, inUnit, stored } from '../../platform/store/crossing.js';
import { among } from '../../platform/store/rows.js';
import { failedAs } from '../../threads/contract/service/failure.js';
import { capabilitiesOf } from '../../threads/store/seat.js';
import { kernelStorageWrites } from './storageWrites.js';
import { makeThreadBranching } from './branch.js';
import { programOf, programWriteUnit } from '../../platform/store/programs.js';
import { plannedFacts } from '../../threads/journal/log.js';
import type { ThreadTranscriptEntry } from '@runlith/agent/transcript/rows';

import { EMPTY_HISTORY, EMPTY_TRANSCRIPT, makeThreadMetadata, makeThreadUnits, threadRowOf } from './threadUnits.js';

export type ThreadStore = Effect.Success<ReturnType<typeof makeThreadStore>>;

export const makeThreadStore = Effect.fnUntraced(function* (input: { readonly reads: RestedFolds | undefined }) {
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const records = yield* ThreadRecords;
  const kinds = yield* ThreadEntryKinds;
  const folds = yield* makeFoldWriter(input);
  const work = yield* makeThreadUnits({ fold: folds });
  const { history, entries } = folds;
  const { metadata } = yield* makeThreadMetadata;
  const branching = yield* makeThreadBranching({ folds });

  const rowOf = <T extends ThreadMetadataRow>(row: T) => threadRowOf(kinds, row);

  const metadataWhere = (call: string, where: SQL | undefined, tx?: Unit<'machine'>) =>
    work.read(call, tx, (unit) =>
      Effect.flatMap(unit.run(db.select(metadataColumns).from(threadRow).where(where)), (rows) => Effect.forEach(rows, rowOf)),
    );

  const metadataInBirthOrder = (call: string, where: SQL | undefined, tx?: Unit<'machine'>) =>
    work.read(call, tx, (unit) =>
      Effect.flatMap(
        unit.run(db.select(metadataColumns).from(threadRow).where(where).orderBy(asc(threadRow.createdAt), asc(threadRow.id))),
        (rows) => Effect.forEach(rows, rowOf),
      ),
    );

  const rowWhere = (call: string, where: SQL | undefined, tx?: Unit<'machine'>) =>
    work.read(call, tx, (unit) =>
      Effect.gen(function* () {
        const row = yield* unit.run(db.select(rowColumns).from(threadRow).where(where).get());
        return row ? ((yield* work.materialize(unit, row)) ?? undefined) : undefined;
      }),
    );

  return {
    folds,
    kinds,
    metadata,
    transaction: <T, E>(body: (tx: WriteUnit<'machine'>) => Effect.Effect<T, E>) => inUnit(units, kernelStorageWrites, 'transaction', body),
    program: <T, E>(identity: string, body: (tx: WriteUnit<'machine'>) => Effect.Effect<T, E>) =>
      inProgram(units, kernelStorageWrites, identity, 'program', (program) => body(programWriteUnit(program))),
    metadataOf: (ids: readonly string[], tx?: Unit<'machine'>): Effect.Effect<readonly ThreadMetadataRow[], ThreadStorageFailed> =>
      ids.length === 0
        ? Effect.succeed([])
        : work.read('metadataOf', tx, (unit) =>
            Effect.flatMap(
              unit.run(
                db
                  .select(metadataColumns)
                  .from(threadRow)
                  .where(inArray(threadRow.id, among([...new Set(ids)]))),
              ),
              (rows) => Effect.forEach(rows, rowOf),
            ),
          ),
    capabilities: (id: string) => work.read('capabilities', undefined, (unit) => capabilitiesOf(db, unit, id)),
    foreign: (id: string) =>
      work.read('foreign', undefined, (unit) =>
        Effect.map(
          unit.run(db.select({ harness: threadRecord.harness }).from(threadRecord).where(eq(threadRecord.id, id)).get()),
          (row) => row !== undefined && row.harness !== NATIVE_HARNESS,
        ),
      ),
    systemPromptOf: (id: string, tx?: Unit<'machine'>) =>
      work.read('systemPromptOf', tx, (unit) =>
        unit.run(
          db
            .select({
              systemPrompt: threadRow.systemPrompt,
              pendingSystemPrompt: threadRow.pendingSystemPrompt,
              pendingDefinition: threadRow.pendingDefinition,
            })
            .from(threadRow)
            .where(eq(threadRow.id, id))
            .get(),
        ),
      ),
    find: (id: string, tx?: Unit<'machine'>) => work.read('find', tx, (unit) => work.findIn(unit, id)),
    findOwned: (id: string, ownerId: string, tx?: Unit<'machine'>) =>
      rowWhere('findOwned', and(eq(threadRow.id, id), eq(threadRow.ownerId, ownerId)), tx),
    logs: (id: string, tx?: Unit<'machine'>) =>
      work.read('logs', tx, (unit) =>
        Effect.gen(function* () {
          const logged = yield* work.required(unit, id, history.read(unit, id));
          if (logged === null) return null;
          return { history: logged, transcript: yield* entries.transcript(unit, id) };
        }),
      ),
    transcriptOf: (id: string, tx?: Unit<'machine'>) =>
      work.read('transcriptOf', tx, (unit) =>
        work
          .required(
            unit,
            id,
            Effect.map(work.hasLog(unit, id), (standing) => (standing ? id : null)),
          )
          .pipe(Effect.flatMap((present) => (present === null ? Effect.succeed(null) : entries.transcript(unit, id)))),
      ),
    historyOf: (id: string, tx?: Unit<'machine'>) => work.read('historyOf', tx, (unit) => work.required(unit, id, history.read(unit, id))),
    toldTailOf: (id: string, key: string) =>
      work.read('toldTailOf', undefined, (unit) => work.required(unit, id, history.toldTail(unit, id, key))),
    toldStateOf: (id: string, key: string, toolCallId?: string) =>
      work.read('toldStateOf', undefined, (unit) => history.toldState(unit, id, key, toolCallId)),
    entriesOfRun: (id: string, runId: string, tx?: Unit<'machine'>) =>
      work.read('entriesOfRun', tx, (unit) => entries.ofRun(unit, id, runId)),
    openQuestionsOfRun: (id: string, runId: string, tx?: Unit<'machine'>) =>
      work.read('openQuestionsOfRun', tx, (unit) => entries.openQuestionsOfRun(unit, id, runId)),
    entryById: (id: string, entryId: string, tx?: Unit<'machine'>) => {
      const program = tx === undefined ? null : programOf(tx);
      if (program === null) return work.read('entryById', tx, (unit) => entries.byId(unit, id, entryId));
      const own = plannedFacts(program, id)?.findLast(
        (fact) => (fact.payload as { readonly entry?: { readonly id?: unknown } }).entry?.id === entryId,
      );
      if (own !== undefined) return Effect.succeed((own.payload as { readonly entry: ThreadTranscriptEntry }).entry);
      return work.read('entryById', undefined, (unit) => entries.byId(unit, id, entryId));
    },
    questionById: (id: string, questionId: string, tx?: Unit<'machine'>) =>
      work.read('questionById', tx, (unit) => entries.questionById(unit, id, questionId)),
    transcriptWindow: (id: string, query: ThreadTranscriptQuery, tx?: Unit<'machine'>) =>
      work.read('transcriptWindow', tx, (unit) =>
        Effect.gen(function* () {
          const page = yield* entries.window(unit, id, query);
          if (page.entries.length > 0) return page;
          const row = yield* unit.run(db.select({ id: threadRow.id }).from(threadRow).where(eq(threadRow.id, id)).get());
          return row ? page : null;
        }),
      ),
    insert: (values: ThreadInsertValues, tx?: WriteUnit<'machine'>) => {
      if (values.parentThreadId) {
        return Effect.fail(
          new ThreadStorageFailed({
            call: 'insert',
            cause: new Error('Child threads must be inserted through ThreadStore.insertChild.'),
          }),
        );
      }
      const id = values.id ?? uuidv7();
      return work.write('insert', tx, (unit) =>
        work.insertRow(unit, {
          ...values,
          id,
          spawnRootId: id,
          cacheGroup: values.cacheGroup ?? id,
          authority: values.authority ?? THREAD_AUTHORITY_DEFAULT,
        }),
      );
    },
    insertChild: (parentThreadId: string, values: Omit<ThreadInsertValues, 'parentThreadId'>, tx: WriteUnit<'machine'>) =>
      failedAs(
        'insertChild',
        Effect.gen(function* () {
          const parent = yield* tx.run(db.select(rowColumns).from(threadRow).where(eq(threadRow.id, parentThreadId)).get());
          if (!parent) return yield* Effect.fail(new ThreadNotFoundError(parentThreadId));
          return yield* work.insertRow(tx, {
            ...values,
            parentThreadId,
            id: values.id ?? uuidv7(),
            spawnRootId: parent.spawnRootId,
            cacheGroup: values.cacheGroup ?? parent.cacheGroup,
            authority: values.authority ?? parent.authority,
          });
        }),
      ),
    update: (id: string, patch: ThreadPatch, tx?: WriteUnit<'machine'>): Effect.Effect<void, ThreadStorageFailed> =>
      Object.keys(patch).length === 0 ? Effect.void : work.write('update', tx, (unit) => work.apply(unit, id, patch)),
    appendEntries: (
      id: string,
      input: { history?: ThreadHistory; transcript?: ThreadTranscript },
    ): Effect.Effect<void, ThreadStorageFailed> => {
      const added = input.history ?? EMPTY_HISTORY;
      const transcript = input.transcript ?? EMPTY_TRANSCRIPT;
      if (added.length === 0 && transcript.length === 0) return Effect.void;
      return stored('appendEntries')(
        units.write(kernelStorageWrites, (unit) =>
          Effect.gen(function* () {
            const record = yield* unit.run(db.select({ id: threadRow.id }).from(threadRow).where(eq(threadRow.id, id)).get());
            if (record === undefined) return;
            const { head: standing } = yield* entries.project(unit, id);
            const current = yield* work.required(unit, id, history.read(unit, id));
            if (current === null) return;
            if (added.length > 0) yield* history.write(unit, id, [...current, ...added], standing);
            yield* entries.place(
              unit,
              id,
              transcript.map((entry) => ({ kind: 'append' as const, entry })),
            );
            yield* unit.run(
              db
                .update(thread)
                .set({ updatedAt: new Date(yield* Clock.currentTimeMillis) })
                .where(eq(thread.id, id)),
            );
          }),
        ),
      );
    },
    branch: branching.branch,
    delete: (ids: readonly string[], tx?: WriteUnit<'machine'>) =>
      work.write('delete', tx, (unit) => Effect.andThen(branching.release(unit, ids), records.remove(unit, ids))),
    findNamed: (spawnRootId: string, ownerId: string, name: string, tx?: Unit<'machine'>) =>
      rowWhere('findNamed', and(eq(threadRow.spawnRootId, spawnRootId), eq(threadRow.ownerId, ownerId), eq(threadRow.name, name)), tx),
    pageTeam: (ask: ThreadTeamAsk, tx?: Unit<'machine'>) => {
      const team = and(
        eq(threadRow.spawnRootId, ask.spawnRootId),
        eq(threadRow.ownerId, ask.ownerId),
        ask.parent === undefined ? undefined : eq(threadRow.parentThreadId, ask.parent),
      );
      const going = sql`exists (select 1 from ${threadRun} where ${threadRun.threadId} = ${threadRow.id} and ${threadRun.status} = 'running')`;
      const after = ask.after === undefined ? undefined : { movedAt: sql`${ask.after.movedAt.getTime()}`, id: ask.after.id };
      return work.read('pageTeam', tx, (unit) =>
        Effect.gen(function* () {
          const found = yield* unit.run(
            db
              .select(metadataColumns)
              .from(threadRow)
              .where(
                and(
                  team,
                  ask.within === 'running' ? going : sql`not ${going}`,
                  after === undefined
                    ? undefined
                    : or(lt(threadRow.updatedAt, after.movedAt), and(eq(threadRow.updatedAt, after.movedAt), lt(threadRow.id, after.id))),
                ),
              )
              .orderBy(desc(threadRow.updatedAt), desc(threadRow.id))
              .limit(ask.limit),
          );
          const counted = yield* unit.run(
            db
              .select({ total: sql<number>`count(*)` })
              .from(threadRow)
              .where(team)
              .get(),
          );
          return { rows: yield* Effect.forEach(found, rowOf), total: counted?.total ?? 0 };
        }),
      );
    },
    listByHost: (ownerId: string, hostKind: string, hostId: string, tx?: Unit<'machine'>) =>
      metadataInBirthOrder(
        'listByHost',
        and(eq(threadRow.ownerId, ownerId), eq(threadRow.hostKind, hostKind), eq(threadRow.hostId, hostId)),
        tx,
      ),
    listByParent: (ownerId: string, parentThreadId: string, tx?: Unit<'machine'>) =>
      metadataInBirthOrder('listByParent', and(eq(threadRow.ownerId, ownerId), eq(threadRow.parentThreadId, parentThreadId)), tx),
    listSubtree: (ownerId: string, threadId: string) =>
      metadataWhere('listSubtree', and(eq(threadRow.ownerId, ownerId), sql`${threadRow.id} in ${subtreeOf(threadId)}`)),
    holdSubtree: (ownerId: string, threadId: string, tx: WriteUnit<'machine'>) =>
      metadataWhere('holdSubtree', and(eq(threadRow.ownerId, ownerId), sql`${threadRow.id} in ${subtreeOf(threadId)}`), tx),
  };
});
