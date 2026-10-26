import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { Context, Effect } from 'effect';
import type { ExecutionRef, InstallationId } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import type { StoreDb } from '../../platform/contract/service/store.js';
import { among } from '../../platform/store/rows.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import type { TerminalListQuery, TerminalRecord } from '../contract/wire/terminals.js';
import { command, custodyNotice, terminal, terminalWriter } from './terminal.js';
import { noteProjected } from './terminalDischarge.js';
import { commandOf, noticeOf, queried, terminalOf } from './rows.js';
import { type CustodyNotice, type CustodyNoticeCursor, HOST_REPLACED } from '../contract/service/custody.js';

export const INVENTORY_PAGE = 200;

const RECORDS_PER_QUERY = 500;

export type TerminalListing = { readonly records: readonly TerminalRecord[]; readonly total: number };

export const replacedNoticeId = (execution: ExecutionRef): string => `replaced:${execution.execution}:${execution.incarnation}`;

export type TerminalRows = ReturnType<typeof makeTerminalRows>;

export const TerminalRows = Context.Service<TerminalRows>('tagma/executions/TerminalRows');

export const makeTerminalRows = ({ db, installation }: { readonly db: StoreDb<'machine'>; readonly installation: InstallationId }) => {
  const recordOf = (row: typeof terminal.$inferSelect) => terminalOf(installation, row);

  const openNotice = Effect.fn('TerminalRows.openNotice')(function* (unit: WriteUnit<'machine'>, notice: CustodyNotice) {
    yield* queried(
      unit,
      db
        .insert(custodyNotice)
        .values({
          projectId: notice.projectId,
          operationId: notice.operationId,
          threadId: notice.thread,
          requester: notice.requester,
          executionId: notice.execution.execution,
          incarnation: notice.execution.incarnation,
          expected: notice.expected,
          name: notice.name,
          state: notice.state,
          openedAt: new Date(notice.openedAt),
        })
        .onConflictDoNothing(),
    );
  });

  return {
    project: Effect.fn('TerminalRows.project')(function* (unit: WriteUnit<'machine'>, record: TerminalRecord) {
      const values = {
        executionId: record.execution.execution,
        incarnation: record.execution.incarnation,
        projectId: record.projectId,
        transport: record.transport,
        lifetime: record.lifetime,
        targetKey: record.targetKey,
        holder: record.holder,
        origin: record.origin,
        revision: record.revision,
        rootUseId: record.holdings.rootUse ?? null,
        environmentUseId: record.holdings.environmentUse ?? null,
        heldByThread: record.heldBy ?? null,
        label: record.label ?? null,
        commandLine: record.commandLine ?? null,
        program: record.program ?? null,
        cwd: record.cwd ?? null,
        quarantine: record.quarantine ?? null,
        rootId: record.rootId ?? null,
        launchedFor: record.launchedFor ?? null,
        shellKey: record.shellKey ?? null,
        acceptedAt: new Date(record.acceptedAt),
      };
      yield* queried(
        unit,
        db
          .insert(terminal)
          .values(values)
          .onConflictDoUpdate({
            target: terminal.executionId,
            setWhere: lt(terminal.revision, record.revision),
            set: {
              ...values,
              heldByThread: sql`case when ${terminal.dischargedAt} is null then ${values.heldByThread} else null end`,
              rootUseId: sql`case when ${terminal.dischargedAt} is null then ${values.rootUseId} else ${terminal.rootUseId} end`,
            },
          }),
      );
      yield* noteProjected(db, unit, record.execution.execution);
    }),

    record: Effect.fn('TerminalRows.record')(function* (unit: Unit<'machine'>, executionId: string) {
      const rows = yield* queried(unit, db.select().from(terminal).where(eq(terminal.executionId, executionId)).all());
      const row = rows[0];
      return row === undefined ? null : yield* recordOf(row);
    }),

    records: Effect.fn('TerminalRows.records')(function* (unit: Unit<'machine'>, executionIds: readonly string[]) {
      const found = new Map<string, TerminalRecord>();
      for (let at = 0; at < executionIds.length; at += RECORDS_PER_QUERY) {
        const rows = yield* queried(
          unit,
          db
            .select()
            .from(terminal)
            .where(inArray(terminal.executionId, executionIds.slice(at, at + RECORDS_PER_QUERY)))
            .all(),
        );
        for (const row of rows) found.set(row.executionId, yield* recordOf(row));
      }
      return found;
    }),

    shell: Effect.fn('TerminalRows.shell')(function* (unit: Unit<'machine'>, shellKey: string) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminal)
          .where(and(eq(terminal.shellKey, shellKey), isNull(terminal.dischargedAt)))
          .all(),
      );
      const row = rows[0];
      return row === undefined ? null : yield* recordOf(row);
    }),

    inventory: Effect.fn('TerminalRows.inventory')(function* (unit: Unit<'machine'>, projectId: number, query: TerminalListQuery) {
      const standing = query.standing ?? true;
      const limit = query.limit ?? INVENTORY_PAGE;
      const filters = [
        eq(terminal.projectId, projectId),
        ...(standing ? [isNull(terminal.dischargedAt)] : []),
        ...(query.holder === undefined ? [] : [eq(terminal.holder, query.holder)]),
        ...(query.execution === undefined ? [] : [eq(terminal.executionId, query.execution)]),
      ];
      const after = query.after;
      const beyond =
        after === undefined
          ? null
          : or(
              lt(terminal.acceptedAt, new Date(after.acceptedAt)),
              and(eq(terminal.acceptedAt, new Date(after.acceptedAt)), lt(terminal.executionId, after.execution)),
            );
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminal)
          .where(and(...filters, ...(beyond === null ? [] : [beyond])))
          .orderBy(desc(terminal.acceptedAt), desc(terminal.executionId))
          .limit(limit)
          .all(),
      );
      const records = yield* Effect.forEach(rows, recordOf);
      const counted = yield* queried(
        unit,
        db
          .select({ count: sql<number>`count(*)` })
          .from(terminal)
          .where(and(...filters))
          .all(),
      );
      return { records, total: counted[0]?.count ?? 0 };
    }),

    heldBy: Effect.fn('TerminalRows.heldBy')(function* (unit: Unit<'machine'>, threadIds: readonly ThreadId[]) {
      if (threadIds.length === 0) return [];
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminal)
          .where(inArray(terminal.heldByThread, among(threadIds)))
          .all(),
      );
      return yield* Effect.forEach(rows, recordOf);
    }),

    holdingUses: Effect.fn('TerminalRows.holdingUses')(function* (unit: Unit<'machine'>, projectId: number, useIds: readonly string[]) {
      if (useIds.length === 0) return { terminals: [], commands: [] };
      const terminals = yield* queried(
        unit,
        db
          .select()
          .from(terminal)
          .where(and(eq(terminal.projectId, projectId), inArray(terminal.rootUseId, [...useIds])))
          .all(),
      );
      const commands = yield* queried(
        unit,
        db
          .select()
          .from(command)
          .where(and(eq(command.projectId, projectId), inArray(command.rootUseId, [...useIds])))
          .all(),
      );
      return {
        terminals: yield* Effect.forEach(terminals, recordOf),
        commands: yield* Effect.forEach(commands, (row) => commandOf(installation, row)),
      };
    }),

    standing: Effect.fn('TerminalRows.standing')(function* (unit: Unit<'machine'>) {
      const rows = yield* queried(unit, db.select().from(terminal).where(isNull(terminal.dischargedAt)).all());
      return yield* Effect.forEach(rows, recordOf);
    }),

    held: Effect.fn('TerminalRows.held')(function* (unit: Unit<'machine'>) {
      const rows = yield* queried(unit, db.select().from(terminal).where(isNotNull(terminal.heldByThread)).all());
      return yield* Effect.forEach(rows, recordOf);
    }),

    openNotice,

    noticeReplaced: Effect.fn('TerminalRows.noticeReplaced')(function* (
      unit: WriteUnit<'machine'>,
      held: readonly TerminalRecord[],
      at: number,
    ) {
      for (const record of held) {
        if (record.heldBy === undefined) continue;
        yield* openNotice(unit, {
          projectId: record.projectId,
          operationId: replacedNoticeId(record.execution),
          thread: record.heldBy,
          requester: HOST_REPLACED,
          execution: record.execution,
          expected: record.revision,
          name: record.label ?? record.program ?? record.execution.execution,
          state: 'owed',
          openedAt: at,
        });
      }
    }),

    markNotice: Effect.fn('TerminalRows.markNotice')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: string,
      state: 'owed' | 'gone',
      requester?: string,
      from?: 'intent',
    ) {
      const where = and(
        eq(custodyNotice.projectId, projectId),
        eq(custodyNotice.operationId, operationId),
        from === undefined ? undefined : eq(custodyNotice.state, from),
      );
      yield* state === 'gone'
        ? queried(unit, db.delete(custodyNotice).where(where))
        : queried(unit, db.update(custodyNotice).set({ state: 'owed', requester: requester }).where(where));
    }),

    notices: Effect.fn('TerminalRows.notices')(function* (unit: Unit<'machine'>, limit: number, after?: CustodyNoticeCursor) {
      const past =
        after === undefined
          ? undefined
          : or(
              gt(custodyNotice.openedAt, new Date(after.openedAt)),
              and(eq(custodyNotice.openedAt, new Date(after.openedAt)), gt(custodyNotice.projectId, after.projectId)),
              and(
                eq(custodyNotice.openedAt, new Date(after.openedAt)),
                eq(custodyNotice.projectId, after.projectId),
                gt(custodyNotice.operationId, after.operationId),
              ),
            );
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(custodyNotice)
          .where(past)
          .orderBy(asc(custodyNotice.openedAt), asc(custodyNotice.projectId), asc(custodyNotice.operationId))
          .limit(limit)
          .all(),
      );
      return rows.map((row) => noticeOf(installation, row));
    }),

    notice: Effect.fn('TerminalRows.notice')(function* (unit: Unit<'machine'>, projectId: number, operationId: string) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(custodyNotice)
          .where(and(eq(custodyNotice.projectId, projectId), eq(custodyNotice.operationId, operationId)))
          .all(),
      );
      const row = rows[0];
      return row === undefined ? null : noticeOf(installation, row);
    }),

    markWriter: Effect.fn('TerminalRows.markWriter')(function* (
      unit: WriteUnit<'machine'>,
      execution: ExecutionRef,
      writer: Principal,
      at: number,
    ) {
      yield* queried(
        unit,
        db
          .insert(terminalWriter)
          .values({
            executionId: execution.execution,
            incarnation: execution.incarnation,
            writer,
            at: new Date(at),
          })
          .onConflictDoUpdate({
            target: [terminalWriter.executionId, terminalWriter.incarnation, terminalWriter.writer],
            set: { at: sql`max(${terminalWriter.at}, excluded.at)` },
          }),
      );
    }),

    writers: Effect.fn('TerminalRows.writers')(function* (unit: Unit<'machine'>, execution: ExecutionRef) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminalWriter)
          .where(and(eq(terminalWriter.executionId, execution.execution), eq(terminalWriter.incarnation, execution.incarnation)))
          .all(),
      );
      return rows.map((row) => ({ writer: Principal.make(row.writer), at: row.at.getTime() }));
    }),
  };
};
