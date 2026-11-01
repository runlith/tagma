import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { Clock, Context, Effect, Schema } from 'effect';
import { ExecutionId, type ExecutionRef, type InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../platform/contract/service/units.js';
import { recordsAs } from '../../thread-record/facts.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalRefused, TerminalUnavailable } from '../contract/wire/refusals.js';
import { principalOf } from '../terminals/principals.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import { CommandRecord, commandDeliveryOwed, type CommandWaitMode } from '../contract/wire/commands.js';
import { subjectKeyOf, principalOfSubject, type CommandSubject } from '../contract/wire/commandSubject.js';
import type { CommandOrder } from '../contract/wire/commands.js';
import { command, commandFence, commandWait, terminalIntent, terminalRequestKey } from './terminal.js';
import type { CommandDeliveries } from './deliveries.js';
import { armOfStored, commandOf, commandRecordOf, commandStateOf, queried, requestKeyOf, storedTime } from './rows.js';

export type CommandWaitMark = {
  readonly execution: string;
  readonly incarnation: number;
  readonly mode: CommandWaitMode;
  readonly revision: number;
};

export type CommandMarks = {
  readonly waits: readonly CommandWaitMark[];
  readonly newest: string | null;
};

export type CommandPageSelection = {
  readonly owner?: CommandSubject;
  readonly standing?: boolean;
  readonly order?: CommandOrder;
  readonly after?: { readonly admittedAt: number; readonly execution: string };
  readonly limit: number;
};

const ownedBy = (owner: CommandSubject) => {
  if (owner._tag === 'Thread') return eq(command.ownerThread, owner.thread);
  if (owner._tag === 'Service') return eq(command.serviceScope, owner.scope);
  return and(isNull(command.ownerThread), isNull(command.serviceScope));
};

const intendedBy = (owner: CommandSubject) => {
  if (owner._tag === 'Thread') return eq(terminalIntent.incomingThread, owner.thread);
  if (owner._tag === 'Service') return eq(terminalIntent.commandServiceScope, owner.scope);
  return and(isNull(terminalIntent.incomingThread), isNull(terminalIntent.commandServiceScope));
};

const threadsOf = (owners: readonly CommandSubject[]): ThreadId[] =>
  owners.flatMap((owner) => (owner._tag === 'Thread' ? [owner.thread] : []));

const ownedByAny = (owners: readonly CommandSubject[]) => {
  const threads = threadsOf(owners);
  return or(
    threads.length === 0 ? undefined : inArray(command.ownerThread, threads),
    ...owners.filter((owner) => owner._tag !== 'Thread').map(ownedBy),
  );
};

const intendedByAny = (owners: readonly CommandSubject[]) => {
  const threads = threadsOf(owners);
  return or(
    threads.length === 0 ? undefined : inArray(terminalIntent.incomingThread, threads),
    ...owners.filter((owner) => owner._tag !== 'Thread').map(intendedBy),
  );
};

const createdUnder = (column: typeof command.createdRun | typeof terminalIntent.commandCreatedRun, run: string | undefined) =>
  run === undefined ? undefined : eq(column, run);

const waitOfCommand = and(eq(commandWait.executionId, command.executionId), eq(commandWait.incarnation, command.incarnation));

export type CommandRows = ReturnType<typeof makeCommandRows>;

export const CommandRows = Context.Service<CommandRows>('tagma/executions/CommandRows');

export const makeCommandRows = ({
  db,
  installation,
  deliveries,
}: {
  readonly db: StoreDb<'machine'>;
  readonly installation: InstallationId;
  readonly deliveries: CommandDeliveries;
}) => {
  const recordOf = (row: typeof command.$inferSelect) => commandOf(installation, row);

  const recordCommand = Effect.fn('CommandRows.recordCommand')(function* (unit: Unit<'machine'>, executionId: string) {
    const rows = yield* queried(unit, db.select().from(command).where(eq(command.executionId, executionId)).all());
    const row = rows[0];
    return row === undefined ? null : yield* recordOf(row);
  });

  const projectCommand = Effect.fn('CommandRows.projectCommand')(function* (unit: WriteUnit<'machine'>, record: CommandRecord) {
    if (record.execution.installation !== installation) {
      return yield* new TerminalRefused({ reason: 'foreign-project', message: 'This command belongs to another installation.' });
    }
    const standing = yield* recordCommand(unit, record.execution.execution);
    if (standing !== null) {
      const encode = Schema.encodeSync(CommandRecord);
      let admission = record;
      if (standing.holdings.rootUse === undefined && record.holdings.rootUse !== undefined) {
        const waiting = yield* queried(unit, db.select().from(commandWait).where(eq(commandWait.executionId, record.execution.execution)));
        if (waiting.length === 0) {
          const { rootUse: _rootUse, ...holdings } = record.holdings;
          admission = { ...record, holdings };
        }
      }
      if (JSON.stringify(encode(standing)) !== JSON.stringify(encode(admission))) {
        return yield* new TerminalRefused({
          reason: 'stale-authority',
          message: 'Command admission is immutable; an existing execution cannot be attributed again.',
        });
      }
      return;
    }
    const values = {
      executionId: record.execution.execution,
      incarnation: record.execution.incarnation,
      projectId: record.projectId,
      owner: principalOfSubject(record.owner),
      ownerThread: record.owner._tag === 'Thread' ? record.owner.thread : null,
      serviceScope: record.owner._tag === 'Service' ? record.owner.scope : null,
      createdBy:
        record.origin._tag === 'Thread'
          ? principalOf({ _tag: 'Thread', threadId: record.origin.thread, projectId: record.projectId })
          : principalOf({ _tag: 'Operator' }),
      createdRun: record.origin._tag === 'Thread' ? (record.origin.run ?? null) : null,
      createdToolCall: record.origin._tag === 'Thread' ? (record.origin.toolCall ?? null) : null,
      policyIdentity: record.policyIdentity,
      targetKey: record.targetKey,
      label: record.label ?? null,
      commandLine: record.commandLine ?? null,
      program: record.program ?? null,
      cwd: record.cwd ?? null,
      time: record.time === undefined ? null : JSON.stringify(record.time),
      rootUseId: record.holdings.rootUse ?? null,
      environmentUseId: record.holdings.environmentUse ?? null,
      rootId: record.rootId ?? null,
      admittedAt: new Date(record.admittedAt),
    };
    yield* queried(unit, db.insert(command).values(values));
  });

  return {
    commandsStanding: Effect.fn('CommandRows.commandsStanding')(function* (unit: Unit<'machine'>) {
      const rows = yield* queried(unit, db.select({ row: command }).from(command).innerJoin(commandWait, waitOfCommand).all());
      return yield* Effect.forEach(rows, (row) => recordOf(row.row));
    }),

    projectCommand,

    admitCommand: Effect.fn('CommandRows.admitCommand')(function* (
      unit: WriteUnit<'machine'>,
      key: TerminalOperationKey,
      execution: ExecutionRef,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(terminalIntent)
          .where(and(eq(terminalIntent.projectId, key.projectId), eq(terminalIntent.operationId, key.operationId)))
          .all(),
      );
      const held = rows[0];
      const missing = (what: string) =>
        new TerminalUnavailable({
          owner: 'store',
          message: `A command admission for ${key.operationId} stands without its ${what}; nothing is projected over it.`,
        });
      if (held === undefined) return yield* missing('intent');
      if (held.commandCreatedBy === null || held.commandPolicyIdentity === null) return yield* missing('origin');
      const owner =
        held.commandServiceScope !== null
          ? { _tag: 'Service' as const, scope: held.commandServiceScope }
          : held.incomingThread !== null
            ? { _tag: 'Thread' as const, thread: ThreadId.make(held.incomingThread) }
            : { _tag: 'Operator' as const };
      const created = yield* armOfStored(held.commandCreatedBy, key.projectId);
      if (created._tag === 'Operator' && (held.commandCreatedRun !== null || held.commandCreatedToolCall !== null)) {
        return yield* new TerminalUnavailable({
          owner: 'store',
          message: 'A stored command origin mixes an operator birth with thread facts.',
        });
      }
      const record = yield* commandRecordOf({
        projectId: key.projectId,
        execution,
        owner,
        origin:
          created._tag === 'Operator'
            ? created
            : {
                ...created,
                run: held.commandCreatedRun ?? undefined,
                toolCall: held.commandCreatedToolCall ?? undefined,
              },
        policyIdentity: held.commandPolicyIdentity,
        targetKey: key.targetKey,
        holdings: {
          rootUse: held.rootUseId ?? undefined,
          environmentUse: held.environmentUseId ?? undefined,
        },
        label: held.commandLabel ?? undefined,
        commandLine: held.commandLine ?? undefined,
        program: held.commandProgram ?? undefined,
        cwd: held.commandCwd ?? undefined,
        ...storedTime(held.commandTime),
        rootId: held.rootId ?? undefined,
        admittedAt: held.openedAt.getTime(),
      });
      yield* projectCommand(unit, record);
      const mode = held.commandWaitMode ?? 'foreground';
      yield* queried(
        unit,
        db
          .insert(commandWait)
          .values({
            executionId: execution.execution,
            incarnation: execution.incarnation,
            mode,
            revision: 0,
            movedAt: new Date(yield* Clock.currentTimeMillis),
          })
          .onConflictDoNothing(),
      );
      const owed = commandDeliveryOwed(record, mode, yield* Clock.currentTimeMillis);
      if (owed !== null) yield* deliveries.openDelivery(unit, owed);
      return record;
    }),

    recordCommand,

    commandStartedBy: Effect.fn('CommandRows.commandStartedBy')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      call: { readonly thread: ThreadId; readonly run?: string; readonly toolCall: string },
    ) {
      const rows = yield* queried(
        unit,
        db
          .select()
          .from(command)
          .where(
            and(
              eq(command.projectId, projectId),
              eq(command.createdBy, principalOf({ _tag: 'Thread', threadId: call.thread, projectId })),
              call.run === undefined ? isNull(command.createdRun) : eq(command.createdRun, call.run),
              eq(command.createdToolCall, call.toolCall),
            ),
          )
          .orderBy(desc(command.admittedAt), desc(command.executionId))
          .limit(1)
          .all(),
      );
      const row = rows[0];
      return row === undefined ? null : yield* recordOf(row);
    }),

    inventoryCommand: Effect.fn('CommandRows.inventoryCommand')(function* (unit: Unit<'machine'>, projectId: number) {
      const rows = yield* queried(unit, db.select().from(command).where(eq(command.projectId, projectId)).all());
      return yield* Effect.forEach(rows, recordOf);
    }),

    goneOwners: Effect.fn('CommandRows.goneOwners')(function* (unit: Unit<'machine'>, incarnation: number) {
      const rows = yield* queried(
        unit,
        db
          .selectDistinct({ owner: command.ownerThread })
          .from(command)
          .where(
            and(
              eq(command.incarnation, incarnation),
              isNotNull(command.ownerThread),
              isNull(sql`(select r.id from ${recordsAs('r')} where r.id = ${command.ownerThread})`),
            ),
          )
          .all(),
      );
      return rows.flatMap((row) => (row.owner === null ? [] : [row.owner]));
    }),

    commandsHeldBy: Effect.fn('CommandRows.commandsHeldBy')(function* (unit: Unit<'machine'>, threadId: ThreadId) {
      const rows = yield* queried(unit, db.select().from(command).where(eq(command.ownerThread, threadId)).all());
      return yield* Effect.forEach(rows, recordOf);
    }),

    commandPage: Effect.fn('CommandRows.commandPage')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      selection: CommandPageSelection,
    ) {
      const after = selection.after;
      const descending = selection.order === 'newest';
      const beyond =
        after === undefined
          ? null
          : descending
            ? or(
                lt(command.admittedAt, new Date(after.admittedAt)),
                and(eq(command.admittedAt, new Date(after.admittedAt)), lt(command.executionId, after.execution)),
              )
            : or(
                gt(command.admittedAt, new Date(after.admittedAt)),
                and(eq(command.admittedAt, new Date(after.admittedAt)), gt(command.executionId, after.execution)),
              );
      const select = db.select({ row: command, wait: commandWait });
      const active = selection.standing === true;
      const joined = active ? select.from(commandWait).crossJoin(command) : select.from(command).leftJoin(commandWait, waitOfCommand);
      const rows = yield* queried(
        unit,
        joined
          .where(
            and(
              ...(active ? [waitOfCommand] : []),
              eq(command.projectId, projectId),
              ...(selection.owner === undefined ? [] : [ownedBy(selection.owner)]),
              ...(selection.standing === undefined
                ? []
                : [selection.standing ? isNotNull(commandWait.executionId) : isNull(commandWait.executionId)]),
              ...(beyond === null ? [] : [beyond]),
            ),
          )
          .orderBy(
            ...(descending ? [desc(command.admittedAt), desc(command.executionId)] : [asc(command.admittedAt), asc(command.executionId)]),
          )
          .limit(selection.limit)
          .all(),
      );
      return yield* Effect.forEach(rows, (row) => commandStateOf(installation, row.row, row.wait));
    }),

    commandState: Effect.fn('CommandRows.commandState')(function* (unit: Unit<'machine'>, executionId: string) {
      const rows = yield* queried(
        unit,
        db
          .select({ row: command, wait: commandWait })
          .from(command)
          .leftJoin(commandWait, waitOfCommand)
          .where(eq(command.executionId, executionId))
          .all(),
      );
      const row = rows[0];
      return row === undefined ? null : yield* commandStateOf(installation, row.row, row.wait);
    }),

    commandMarks: Effect.fn('CommandRows.commandMarks')(function* (unit: Unit<'machine'>, projectId: number) {
      const waiting = yield* queried(
        unit,
        db
          .select({
            execution: commandWait.executionId,
            incarnation: commandWait.incarnation,
            mode: commandWait.mode,
            revision: commandWait.revision,
          })
          .from(commandWait)
          .all(),
      );
      const owners =
        waiting.length === 0
          ? []
          : yield* queried(
              unit,
              db
                .select({
                  execution: command.executionId,
                  incarnation: command.incarnation,
                  projectId: command.projectId,
                })
                .from(command)
                .where(inArray(command.executionId, [...new Set(waiting.map((wait) => wait.execution))]))
                .all(),
            );
      const ours = new Set(owners.filter((row) => row.projectId === projectId).map((row) => `${row.execution}\u0000${row.incarnation}`));
      const waits = waiting.filter((wait) => ours.has(`${wait.execution}\u0000${wait.incarnation}`));
      const newest = yield* queried(
        unit,
        db
          .select({ execution: command.executionId })
          .from(command)
          .where(eq(command.projectId, projectId))
          .orderBy(desc(command.admittedAt), desc(command.executionId))
          .limit(1)
          .all(),
      );
      return { waits, newest: newest[0]?.execution ?? null } satisfies CommandMarks;
    }),

    commandsHeld: Effect.fn('CommandRows.commandsHeld')(function* (
      unit: Unit<'machine'>,
      after: { readonly admittedAt: number; readonly execution: string } | undefined,
      limit: number,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select({ row: command })
          .from(command)
          .innerJoin(commandWait, waitOfCommand)
          .where(
            after === undefined
              ? undefined
              : or(
                  gt(command.admittedAt, new Date(after.admittedAt)),
                  and(eq(command.admittedAt, new Date(after.admittedAt)), gt(command.executionId, after.execution)),
                ),
          )
          .orderBy(asc(command.admittedAt), asc(command.executionId))
          .limit(limit)
          .all(),
      );
      return rows.map((row) => ({
        projectId: row.row.projectId,
        execution: {
          installation,
          execution: ExecutionId.make(row.row.executionId),
          incarnation: row.row.incarnation,
        } satisfies ExecutionRef,
        admittedAt: row.row.admittedAt.getTime(),
      }));
    }),

    commandsOwnedBy: Effect.fn('CommandRows.commandsOwnedBy')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      owners: readonly CommandSubject[],
      run?: string,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select({ row: command })
          .from(commandWait)
          .crossJoin(command)
          .where(
            and(
              waitOfCommand,
              eq(command.projectId, projectId),
              ownedByAny(owners),
              createdUnder(command.createdRun, run),
              run === undefined ? undefined : eq(commandWait.mode, 'foreground'),
            ),
          )
          .all(),
      );
      return yield* Effect.forEach(rows, (row) => recordOf(row.row));
    }),

    commandIntentsOf: Effect.fn('CommandRows.commandIntentsOf')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      owners: readonly CommandSubject[],
      run?: string,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select({ key: terminalRequestKey })
          .from(terminalIntent)
          .innerJoin(
            terminalRequestKey,
            and(eq(terminalRequestKey.projectId, terminalIntent.projectId), eq(terminalRequestKey.operationId, terminalIntent.operationId)),
          )
          .where(
            and(
              eq(terminalIntent.projectId, projectId),
              isNotNull(terminalIntent.commandPolicyIdentity),
              intendedByAny(owners),
              createdUnder(terminalIntent.commandCreatedRun, run),
              run === undefined ? undefined : or(eq(terminalIntent.commandWaitMode, 'foreground'), isNull(terminalIntent.commandWaitMode)),
            ),
          )
          .all(),
      );
      return rows.map((row) => requestKeyOf(installation, row.key));
    }),

    ownerFence: Effect.fn('CommandRows.ownerFence')(function* (unit: Unit<'machine'>, projectId: number, owner: CommandSubject) {
      const rows = yield* queried(
        unit,
        db
          .select({ revision: commandFence.revision })
          .from(commandFence)
          .where(and(eq(commandFence.projectId, projectId), eq(commandFence.ownerKey, subjectKeyOf(owner))))
          .all(),
      );
      return rows[0]?.revision ?? 0;
    }),

    ownerFences: Effect.fn('CommandRows.ownerFences')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      owners: readonly CommandSubject[],
    ) {
      const keys = owners.map(subjectKeyOf);
      const rows = yield* queried(
        unit,
        db
          .select({ ownerKey: commandFence.ownerKey, revision: commandFence.revision })
          .from(commandFence)
          .where(and(eq(commandFence.projectId, projectId), inArray(commandFence.ownerKey, keys)))
          .all(),
      );
      const revisions = new Map(rows.map((row) => [row.ownerKey, row.revision]));
      return keys.map((key) => revisions.get(key) ?? 0);
    }),

    fenceOwners: Effect.fn('CommandRows.fenceOwners')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      owners: readonly CommandSubject[],
    ) {
      const keys = owners.map(subjectKeyOf);
      if (keys.length === 0) return [];
      const movedAt = new Date(yield* Clock.currentTimeMillis);
      const raised = yield* queried(
        unit,
        db
          .insert(commandFence)
          .values(keys.map((ownerKey) => ({ projectId, ownerKey, revision: 1, movedAt })))
          .onConflictDoUpdate({
            target: [commandFence.projectId, commandFence.ownerKey],
            set: { revision: sql`${commandFence.revision} + 1`, movedAt },
          })
          .returning({ ownerKey: commandFence.ownerKey, revision: commandFence.revision }),
      );
      const revisions = new Map(raised.map((row) => [row.ownerKey, row.revision]));
      const unfenced = keys.find((key) => !revisions.has(key));
      if (unfenced !== undefined) {
        return yield* new TerminalUnavailable({
          owner: 'store',
          message: `The admission fence over ${unfenced} could not be raised; nothing was fenced.`,
        });
      }
      return keys.map((key) => revisions.get(key) as number);
    }),
  };
};
