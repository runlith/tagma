import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { among } from '../../platform/store/rows.js';
import { Context, Deferred, Effect, Ref, Schema } from 'effect';
import type { ExecutionRef, HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { MachineUnits, Unit, WriteUnit } from '../../platform/contract/service/units.js';
import type { ThreadId } from '../../platform/contract/wire/thread.js';
import { TerminalIntent, type TerminalHoldings } from '../contract/wire/terminals.js';
import type { TerminalUnavailable } from '../contract/wire/refusals.js';
import { CommandIntentProvenance } from '../contract/wire/commands.js';
import type { GenerationEndedReason } from '../host/generationEnded.js';
import { terminalIntent, terminalRequestKey } from './terminal.js';
import { dischargeCommand, dischargeTerminal, generationsBelow, readEndedReason, readObligation } from './terminalDischarge.js';
import { seedAll } from './terminalSeeding.js';
import type { RequestKeys, RequestSettlement } from './requestKeys.js';
import { decoded, queried, requestKeyOf, storedTime } from './rows.js';

export type Obligation = {
  readonly kind: 'terminal' | 'command';
  readonly holdings: TerminalHoldings;
  readonly discharged: boolean;
};

const decodeIntent = Schema.decodeUnknownEffect(TerminalIntent);
const decodeCommandOrigin = Schema.decodeUnknownEffect(CommandIntentProvenance);

export type TerminalIntents = ReturnType<typeof makeTerminalIntents>;

export const TerminalIntents = Context.Service<TerminalIntents>('tagma/executions/TerminalIntents');

export const makeTerminalIntents = ({
  db,
  installation,
  keys,
}: {
  readonly db: StoreDb<'machine'>;
  readonly installation: InstallationId;
  readonly keys: RequestKeys;
}) => {
  const seedGate = Deferred.makeUnsafe<void, TerminalUnavailable>();
  const seeding = Ref.makeUnsafe(false);
  const withKey = (projectId: number, operationId: HostRequestKey) =>
    and(eq(terminalIntent.projectId, projectId), eq(terminalIntent.operationId, operationId));
  const keyed = and(
    eq(terminalRequestKey.projectId, terminalIntent.projectId),
    eq(terminalRequestKey.operationId, terminalIntent.operationId),
  );

  return {
    fence: Effect.fn('TerminalIntents.fence')(function* (
      unit: WriteUnit<'machine'>,
      intent: TerminalIntent,
      command?: CommandIntentProvenance,
    ) {
      yield* keys.unspent(unit, intent.key.projectId, intent.key.operationId);
      yield* queried(
        unit,
        db.insert(terminalIntent).values({
          projectId: intent.key.projectId,
          operationId: intent.key.operationId,
          phase: intent.phase,
          rootUseId: intent.holdings.rootUse ?? null,
          environmentUseId: intent.holdings.environmentUse ?? null,
          outgoingThread: intent.outgoing ?? null,
          incomingThread: intent.incoming ?? null,
          commandServiceScope: command?.serviceScope ?? null,
          commandCreatedBy: command?.createdBy ?? null,
          commandCreatedRun: command?.createdRun ?? null,
          commandCreatedToolCall: command?.createdToolCall ?? null,
          commandPolicyIdentity: command?.policyIdentity ?? null,
          commandWaitMode: command?.wait ?? null,
          commandLabel: command?.label ?? null,
          commandLine: command?.commandLine ?? null,
          commandProgram: command?.program ?? null,
          commandCwd: command?.cwd ?? null,
          commandTime: command?.time === undefined ? null : JSON.stringify(command.time),
          rootId: intent.rootId ?? null,
          launchedFor: intent.launchedFor ?? null,
          shellKey: intent.shellKey ?? null,
          openedAt: new Date(intent.openedAt),
        }),
      );
    }),

    commandOrigin: Effect.fn('TerminalIntents.commandOrigin')(function* (
      unit: Unit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
    ) {
      const rows = yield* queried(
        unit,
        db
          .select({ intent: terminalIntent, key: terminalRequestKey })
          .from(terminalIntent)
          .innerJoin(terminalRequestKey, keyed)
          .where(withKey(projectId, operationId))
          .all(),
      );
      const row = rows[0];
      if (row === undefined || row.intent.commandPolicyIdentity === null) return null;
      return yield* decoded(decodeCommandOrigin, {
        serviceScope: row.intent.commandServiceScope ?? undefined,
        createdBy: row.intent.commandCreatedBy ?? undefined,
        createdRun: row.intent.commandCreatedRun ?? undefined,
        createdToolCall: row.intent.commandCreatedToolCall ?? undefined,
        policyIdentity: row.intent.commandPolicyIdentity ?? undefined,
        wait: row.intent.commandWaitMode ?? 'foreground',
        label: row.intent.commandLabel ?? undefined,
        commandLine: row.intent.commandLine ?? undefined,
        program: row.intent.commandProgram ?? undefined,
        cwd: row.intent.commandCwd ?? undefined,
        ...storedTime(row.intent.commandTime),
      });
    }),

    advance: Effect.fn('TerminalIntents.advance')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
      phase: 'dispatched' | 'uncertain',
    ) {
      yield* keys.unspent(unit, projectId, operationId);
      yield* queried(
        unit,
        db
          .update(terminalIntent)
          .set({ phase })
          .where(and(withKey(projectId, operationId), phase === 'dispatched' ? eq(terminalIntent.phase, 'reserved') : sql`1 = 1`)),
      );
      if (phase === 'uncertain') yield* keys.markUncertain(unit, projectId, operationId);
    }),

    settle: Effect.fn('TerminalIntents.settle')(function* (
      unit: WriteUnit<'machine'>,
      projectId: number,
      operationId: HostRequestKey,
      outcome: RequestSettlement,
    ) {
      yield* keys.settle(unit, projectId, operationId, outcome);
      if (outcome._tag === 'Settled') yield* queried(unit, db.delete(terminalIntent).where(withKey(projectId, operationId)));
    }),

    intent: Effect.fn('TerminalIntents.intent')(function* (unit: Unit<'machine'>, projectId: number, operationId: HostRequestKey) {
      const rows = yield* queried(
        unit,
        db
          .select({ intent: terminalIntent, key: terminalRequestKey })
          .from(terminalIntent)
          .innerJoin(terminalRequestKey, keyed)
          .where(withKey(projectId, operationId))
          .all(),
      );
      const row = rows[0];
      if (row === undefined) return null;
      return yield* decoded(decodeIntent, {
        key: requestKeyOf(installation, row.key),
        phase: row.intent.phase,
        holdings: {
          rootUse: row.intent.rootUseId ?? undefined,
          environmentUse: row.intent.environmentUseId ?? undefined,
        },
        outgoing: row.intent.outgoingThread ?? undefined,
        incoming: row.intent.incomingThread ?? undefined,
        rootId: row.intent.rootId ?? undefined,
        launchedFor: row.intent.launchedFor ?? undefined,
        shellKey: row.intent.shellKey ?? undefined,
        openedAt: row.intent.openedAt.getTime(),
      });
    }),

    unresolved: Effect.fn('TerminalIntents.unresolved')(function* (unit: Unit<'machine'>, executionId: string, incarnation: number) {
      const rows = yield* queried(
        unit,
        db
          .select({ key: terminalRequestKey })
          .from(terminalIntent)
          .innerJoin(terminalRequestKey, keyed)
          .where(and(eq(terminalRequestKey.executionId, executionId), eq(terminalRequestKey.incarnation, incarnation)))
          .all(),
      );
      return rows.map((row) => requestKeyOf(installation, row.key));
    }),

    fencesOf: Effect.fn('TerminalIntents.fencesOf')(function* (unit: Unit<'machine'>, threadIds: readonly ThreadId[]) {
      const rows = yield* queried(
        unit,
        db
          .select({ key: terminalRequestKey })
          .from(terminalIntent)
          .innerJoin(terminalRequestKey, keyed)
          .where(or(inArray(terminalIntent.outgoingThread, among(threadIds)), inArray(terminalIntent.incomingThread, among(threadIds))))
          .all(),
      );
      return rows.map((row) => requestKeyOf(installation, row.key));
    }),

    discharge: (unit: WriteUnit<'machine'>, execution: ExecutionRef, reason?: GenerationEndedReason) =>
      dischargeTerminal(db, unit, execution, reason).pipe(Effect.withSpan('TerminalIntents.discharge')),

    dischargeCommand: (unit: WriteUnit<'machine'>, execution: ExecutionRef, reason?: GenerationEndedReason) =>
      dischargeCommand(db, unit, execution, reason).pipe(Effect.withSpan('TerminalIntents.dischargeCommand')),

    endedReason: (unit: Unit<'machine'>, kind: 'terminal' | 'command', executionId: string) =>
      readEndedReason(db, unit, kind, executionId).pipe(Effect.withSpan('TerminalIntents.endedReason')),

    obligation: (unit: Unit<'machine'>, projectId: number, execution: ExecutionRef) =>
      readObligation(db, unit, projectId, execution).pipe(Effect.withSpan('TerminalIntents.obligation')),

    below: (unit: Unit<'machine'>, generation: number) =>
      generationsBelow(db, unit, installation, generation, seedGate, seeding).pipe(Effect.withSpan('TerminalIntents.below')),

    seedOpenTerminals: (units: MachineUnits['Service']) => seedAll(db, units, seedGate, seeding),
  };
};
