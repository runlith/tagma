import { Commands } from '@runlith/executions/Commands';
import { TerminalInventory } from './inventory.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CommandRows } from '../store/commandRows.js';
import { RequestKeys } from '../store/requestKeys.js';
import { RootUses } from '../../workspace/contract/service/roots.js';
import { Environments } from '../../workspace/contract/service/environments.js';
import { TerminalIntents } from '../store/intentLifecycle.js';
import { TerminalReconciliation } from './reconciliation.js';
import { TerminalRows } from '../store/terminalRows.js';
import { TerminalGrants } from '../contract/service/grants.js';
import { InputWitness } from './gridControl.js';
import { TerminalWriters } from './writers.js';
import { Executions } from '@runlith/executions/Executions';
import { ExecutionRequest } from '@runlith/executions/ExecutionRequest';
import { HostLifecycle } from '@runlith/executions/HostLifecycle';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import { makeTerminalRecord, makeCommandRecord } from './reads.js';
import type { HeldReading } from './inventory.js';
import { refKey } from './refs.js';
import { createHash } from 'node:crypto';
import { Clock, Effect } from 'effect';
import type { Principal } from '@runlith/executions/protocol/custody';
import type { ExecutionRef, HostRequestRef, HostRequestKey } from '@runlith/executions/protocol/execution';
import type { RetireAnswer } from '@runlith/executions/protocol/wire';
import type { EndingReading } from '@runlith/executions/protocol/stop';
import type { WriteUnit } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import {
  command as commandTable,
  commandWait,
  openTerminal as openTerminalTable,
  terminal as terminalTable,
  terminalIntent,
  terminalRequestKey,
  terminalRequestKeyTally,
} from '../store/terminal.js';
import { rootUse as rootUseTable, rootUseHold } from '../../workspace/store/tables.js';
import { environmentUse as environmentUseTable } from '../../workspace/store/tables.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import type { Disowned } from '@runlith/executions/protocol/keep';
import { TargetKey } from '../contract/wire/targets.js';
import type { TerminalOperationKey } from '../contract/wire/requestKeys.js';
import type { GrantRevocation } from '../contract/service/grants.js';
import { GENERATION_ENDED, storeReasonOfRevocation } from '../host/generationEnded.js';
import { INVENTORY_PAGE } from '../store/terminalRows.js';
import { subjectKeyOf, principalOfSubject, type CommandSubject } from '../contract/wire/commandSubject.js';
import type { TerminalDischarge } from '../contract/service/discharge.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { sameRef } from './refs.js';

export const makeTerminalDischarge = Effect.fnUntraced(function* ({ installation }: { readonly installation: InstallationId }) {
  const units = yield* MachineUnits;
  const commandRows = yield* CommandRows;
  const requestKeys = yield* RequestKeys;
  const uses = yield* RootUses;
  const environments = yield* Environments;
  const intents = yield* TerminalIntents;
  const reconciliation = yield* TerminalReconciliation;
  const terminalRows = yield* TerminalRows;
  const grants = yield* TerminalGrants;
  const witness = yield* InputWitness;
  const writers = yield* TerminalWriters;
  const host = yield* Executions;
  const executionRequest = yield* ExecutionRequest;
  const hostLifecycle = yield* HostLifecycle;
  const ref = (operation: HostRequestKey) => ({ installation, operation });
  const readRecord = yield* makeTerminalRecord;
  const readCommand = yield* makeCommandRecord;
  const cell = yield* TerminalInventory;
  const hostCommands = yield* Commands;
  const openedAt = yield* Clock.currentTimeMillis;
  const namedSurvivors = new Set<string>();

  const retire = Effect.fn('Terminals.retire')(function* (
    projectId: number,
    operation: HostRequestRef,
    execution: ExecutionRef,
  ): Effect.fn.Return<RetireAnswer, TerminalFailure> {
    const discharged = yield* ended(projectId, execution);
    if (discharged._tag === 'Retained') {
      return {
        _tag: 'Refused',
        execution,
        reason: 'cleanup-unproven',
        detail: `this installation still holds ${execution.execution}: ${discharged.reason}`,
      } satisfies RetireAnswer;
    }
    return yield* host.retire(operation, execution);
  });

  const disown = Effect.fn('Terminals.disown')(function* (disowned: Disowned) {
    const answered = yield* Effect.result(hostLifecycle.disown(disowned));
    if (answered._tag === 'Failure') {
      yield* Effect.logWarning('the host was not told an owner of kept command output is gone; the next adoption tells it again', {
        ...disowned,
        reason: answered.failure._tag,
      });
    }
  });

  const disownThreads = (threadIds: ReadonlyArray<string>): Effect.Effect<void> =>
    Effect.forEach(threadIds, (threadId) => disown({ owner: principalOfSubject({ _tag: 'Thread', thread: ThreadId.make(threadId) }) }), {
      discard: true,
    });

  const disownProject = (projectId: number): Effect.Effect<void> => disown({ scope: `project:${projectId}` });

  const disownGone = Effect.fn('Terminals.disownGone')(function* () {
    const generation = yield* Effect.result(hostLifecycle.generation());
    if (generation._tag === 'Failure') {
      yield* Effect.logWarning('the owners gone since commands were kept were not disowned: the host generation is unread', {
        reason: generation.failure._tag,
      });
      return;
    }
    const current = generation.success;
    const gone = yield* Effect.result(units.read((unit) => commandRows.goneOwners(unit, current)));
    if (gone._tag === 'Failure') {
      yield* Effect.logWarning(
        'the owners gone since commands were kept could not be read; their output stays until the host generation ends',
        {
          reason: gone.failure._tag,
        },
      );
      return;
    }
    yield* disownThreads(gone.success);
  });

  const ended = Effect.fn('Terminals.ended')(function* (
    projectId: number,
    execution: ExecutionRef,
    remeasure?: boolean,
  ): Effect.fn.Return<TerminalDischarge, TerminalFailure> {
    const reading = yield* host.ending(execution, remeasure);
    if (reading !== undefined) return yield* discharge(projectId, execution, reading);
    const replaced = yield* dischargeReplaced(projectId, execution);
    return replaced._tag === 'Retained' && (replaced.reason === 'not-replaced' || replaced.reason === 'unreadable-generation')
      ? { _tag: 'Retained', reason: 'unended' }
      : replaced;
  });

  const dischargeReplaced = Effect.fn('Terminals.dischargeReplaced')(function* (
    projectId: number,
    execution: ExecutionRef,
  ): Effect.fn.Return<TerminalDischarge, TerminalFailure> {
    const generation = yield* Effect.result(hostLifecycle.generation());
    if (generation._tag === 'Failure') return { _tag: 'Retained', reason: 'unreadable-generation' };
    if (execution.incarnation >= generation.success) return { _tag: 'Retained', reason: 'not-replaced' };
    const obligation = yield* units.read((unit) => intents.obligation(unit, projectId, execution));
    if (obligation?.discharged === true) return { _tag: 'Discharged' };
    const standing = yield* readRecord(execution.execution, execution.incarnation);
    const terminal = standing !== null && standing.projectId === projectId ? standing : null;
    const command = terminal === null ? yield* readCommand(execution.execution, execution.incarnation) : null;
    const owned = command !== null && command.projectId === projectId ? command : null;
    if (terminal === null && owned === null) return { _tag: 'Retained', reason: 'foreign-reference' };
    const holdings = terminal?.holdings ?? owned?.holdings ?? {};
    const key = yield* units.read((unit) => requestKeys.keyOf(unit, execution.execution, execution.incarnation));
    const consumer = { kind: owned === null ? 'terminal' : 'command', id: key?.operationId ?? execution.execution };
    const given = yield* Effect.result(
      units.write(writes('discharge.given', [rootUseTable, environmentUseTable]), (unit: WriteUnit<'machine'>) =>
        Effect.gen(function* () {
          if (holdings.rootUse !== undefined) {
            yield* uses.release(unit, { useId: holdings.rootUse, consumer, outcome: 'abandoned' });
          }
          if (holdings.environmentUse !== undefined) {
            yield* environments.release(unit, holdings.environmentUse, consumer, 'abandoned');
          }
        }),
      ),
    );
    if (given._tag === 'Failure') {
      yield* Effect.logWarning(
        `the holdings of ${execution.execution}:${execution.incarnation} could not be given back (${given.failure._tag}); its custody is ended anyway, because the generation that held it is gone and no proof can ever arrive`,
      );
    }
    yield* units.write(
      writes('discharge.dischargeReplaced', [terminalTable, commandTable, commandWait, openTerminalTable, rootUseTable, rootUseHold]),
      (unit: WriteUnit<'machine'>) =>
        owned === null ? intents.discharge(unit, execution, GENERATION_ENDED) : intents.dischargeCommand(unit, execution, GENERATION_ENDED),
    );
    yield* released(projectId, execution, 'custodian-replaced');
    return { _tag: 'Discharged' };
  });

  const recoverStart = Effect.fn('Terminals.recoverStart')(function* (key: TerminalOperationKey) {
    let answer = yield* executionRequest.operation(ref(key.operationId));
    if (answer._tag === 'Unanswered') {
      const prevented = yield* host.cancelStart(ref(key.operationId), 'explicit-stop', 'recover-unadmitted-start', 'unadmitted');
      if (prevented._tag === 'Prevented') answer = { _tag: 'Cancelled', operation: ref(key.operationId) };
      else answer = yield* executionRequest.operation(ref(key.operationId));
    }
    if (answer._tag === 'Accepted' && answer.execution !== undefined) {
      const execution = answer.execution;
      yield* units.write(writes('discharge.recoverStart', [terminalRequestKey, terminalRequestKeyTally]), (unit) =>
        requestKeys.admit(unit, key.projectId, key.operationId, execution),
      );
      const resolved = yield* reconciliation.operation(key.projectId, key.operationId);
      return resolved._tag === 'Settled' ? 'settled' : 'unresolved';
    }
    if (answer._tag !== 'Cancelled' && answer._tag !== 'Refused') return 'unresolved';
    const intent = yield* units.read((unit) => intents.intent(unit, key.projectId, key.operationId));
    const origin = yield* units.read((unit) => intents.commandOrigin(unit, key.projectId, key.operationId));
    const consumer = { kind: origin === null ? 'terminal' : 'command', id: key.operationId };
    const replaced = answer._tag === 'Refused' && answer.refusal._tag === 'IncarnationMismatch';
    yield* units.write(
      writes('discharge.recoverStart', [rootUseTable, environmentUseTable, terminalRequestKey, terminalRequestKeyTally, terminalIntent]),
      (unit: WriteUnit<'machine'>) =>
        Effect.gen(function* () {
          if (intent?.holdings.rootUse !== undefined) {
            yield* uses.release(unit, { useId: intent.holdings.rootUse, consumer, outcome: replaced ? 'abandoned' : 'unapplied' });
          }
          if (intent?.holdings.environmentUse !== undefined) {
            yield* environments.release(unit, intent.holdings.environmentUse, consumer, replaced ? 'abandoned' : 'never-applied');
          }
          yield* intents.settle(unit, key.projectId, key.operationId, { _tag: 'Settled' });
        }),
    );
    return 'settled';
  });

  const sweepReplaced = Effect.fn('Terminals.sweepReplaced')(function* () {
    const retained = new Map<string, number>();
    const count = (reason: string) => retained.set(reason, (retained.get(reason) ?? 0) + 1);
    const generation = yield* Effect.result(hostLifecycle.generation());
    if (generation._tag === 'Failure') {
      yield* Effect.logWarning(
        `the replaced-generation sweep did not run: the host would not say which generation it stands at (${generation.failure._tag})`,
      );
      return { discharged: 0, retained };
    }
    let after: { readonly projectId: number; readonly operationId: HostRequestKey } | undefined;
    while (true) {
      const page = yield* Effect.result(units.read((unit) => requestKeys.startsBefore(unit, openedAt, after)));
      if (page._tag === 'Failure') {
        count(`start-recovery:${page.failure._tag}`);
        break;
      }
      for (const key of page.success) {
        const recovered = yield* Effect.result(recoverStart(key));
        if (recovered._tag === 'Failure') count(`start-recovery:${recovered.failure._tag}`);
        else if (recovered.success === 'unresolved') count('start-recovery:unresolved');
      }
      after = page.success.at(-1);
      if (page.success.length < INVENTORY_PAGE) break;
    }
    const rows = yield* Effect.result(
      Effect.gen(function* () {
        const terminals = yield* units.read((unit) => terminalRows.held(unit));
        const commands = yield* units.read((unit) => commandRows.commandsStanding(unit));
        return [
          ...terminals.map((row) => ({ projectId: row.projectId, execution: row.execution })),
          ...commands.map((row) => ({ projectId: row.projectId, execution: row.execution })),
        ];
      }),
    );
    if (rows._tag === 'Failure') {
      yield* Effect.logWarning(`the replaced-generation sweep read no rows to sweep (${rows.failure._tag}); nothing was discharged`);
      return { discharged: 0, retained };
    }
    let discharged = 0;
    for (const row of rows.success) {
      if (row.execution.incarnation >= generation.success) continue;
      const answer = yield* Effect.result(dischargeReplaced(row.projectId, row.execution));
      if (answer._tag === 'Failure') count(`failed:${answer.failure._tag}`);
      else if (answer.success._tag === 'Discharged') discharged += 1;
      else count(answer.success.reason);
    }
    const left = [...retained].reduce((sum, [, rows]) => sum + rows, 0);
    if (discharged > 0 || left > 0) {
      const named = [...retained].map(([reason, rows]) => `${rows} ${reason}`).join(', ');
      yield* Effect.log(
        `discharged ${discharged} execution${discharged === 1 ? '' : 's'} of a replaced generation (the host stands at ${generation.success})${left === 0 ? '' : `; ${left} left standing: ${named}`}`,
      );
    }
    const below = yield* Effect.result(units.read((unit) => intents.below(unit, generation.success)));
    if (below._tag === 'Failure') {
      yield* Effect.logWarning(`rows of replaced generations could not be read (${below.failure._tag}); nothing was stamped`);
      return { discharged, retained };
    }
    let stamped = 0;
    for (const ref of below.success) {
      const written = yield* Effect.result(abandonAndDischarge('terminal', ref, 'custodian-replaced'));
      if (written._tag === 'Failure') count(`below:${written.failure._tag}`);
      else stamped += 1;
    }
    if (stamped > 0) {
      yield* Effect.log(`${stamped} terminal row${stamped === 1 ? '' : 's'} of replaced generations left the standing inventory`);
    }
    return { discharged, retained };
  });

  const abandonAndDischarge = Effect.fn('Terminals.abandonAndDischarge')(function* (
    kind: 'terminal' | 'command',
    execution: ExecutionRef,
    cause: GrantRevocation,
  ) {
    const projectId = yield* units.write(
      writes('discharge.projectId', [
        rootUseTable,
        rootUseHold,
        environmentUseTable,
        terminalTable,
        commandTable,
        commandWait,
        openTerminalTable,
      ]),
      (unit) =>
        Effect.gen(function* () {
          const record =
            kind === 'terminal'
              ? yield* terminalRows.record(unit, execution.execution)
              : yield* commandRows.recordCommand(unit, execution.execution);
          if (record === null || record.execution.incarnation !== execution.incarnation) return undefined;
          const key = yield* requestKeys.keyOf(unit, execution.execution, execution.incarnation);
          const consumer = { kind, id: key?.operationId ?? execution.execution };
          if (record.holdings.rootUse !== undefined) {
            const given = yield* Effect.result(uses.release(unit, { useId: record.holdings.rootUse, consumer, outcome: 'abandoned' }));
            if (given._tag === 'Failure') {
              yield* Effect.logWarning('a use the ledger would not take kept standing; its custody ends anyway', {
                execution: execution.execution,
                useId: record.holdings.rootUse,
                refusal: given.failure._tag,
              });
            }
          }
          if (record.holdings.environmentUse !== undefined) {
            const given = yield* Effect.result(environments.release(unit, record.holdings.environmentUse, consumer, 'abandoned'));
            if (given._tag === 'Failure') {
              yield* Effect.logWarning('a use the ledger would not take kept standing; its custody ends anyway', {
                execution: execution.execution,
                useId: record.holdings.environmentUse,
                refusal: given.failure._tag,
              });
            }
          }
          const reason = storeReasonOfRevocation(cause);
          if (kind === 'terminal') yield* intents.discharge(unit, execution, reason);
          else yield* intents.dischargeCommand(unit, execution, reason);
          return record.projectId;
        }),
    );
    if (projectId !== undefined) yield* released(projectId, execution, cause);
  });

  const released = Effect.fn('Terminals.released')(function* (
    projectId: number,
    execution: ExecutionRef,
    cause: GrantRevocation,
  ): Effect.fn.Return<void, TerminalFailure> {
    yield* grants.endOver(projectId, execution, cause);
    yield* witness.ended(execution);
    if (writers !== null) yield* writers.ended(execution);
  });

  const discharge = Effect.fn('Terminals.discharge')(function* (
    projectId: number,
    execution: ExecutionRef,
    receipt: EndingReading,
  ): Effect.fn.Return<TerminalDischarge, TerminalFailure> {
    const obligation = yield* units.read((unit) => intents.obligation(unit, projectId, execution));
    if (obligation === null || !sameRef(receipt.execution, execution)) {
      return { _tag: 'Retained', reason: 'foreign-reference' };
    }
    const fresh = receipt.measurement === 'remeasured';
    if (!fresh && receipt.cleanup !== 'complete') return { _tag: 'Retained', reason: 'incomplete-cleanup' };
    if (receipt.residual.length > 0) return { _tag: 'Retained', reason: 'residual' };
    if (receipt.unverifiable.length > 0) return { _tag: 'Retained', reason: 'unmeasured' };
    const pending = yield* units.read((unit) => intents.unresolved(unit, execution.execution, execution.incarnation));
    if (pending.length > 0) return { _tag: 'Retained', reason: 'unresolved-operation' };
    if (obligation.discharged) {
      yield* released(projectId, execution, 'execution-ended');
      return { _tag: 'Discharged' };
    }
    const key = yield* units.read((unit) => requestKeys.keyOf(unit, execution.execution, execution.incarnation));
    const consumer = { kind: obligation.kind, id: key?.operationId ?? execution.execution };
    const proved = receipt.cleanup === 'complete';
    yield* units.write(
      writes('discharge.discharge', [
        rootUseTable,
        rootUseHold,
        environmentUseTable,
        terminalTable,
        commandTable,
        commandWait,
        openTerminalTable,
      ]),
      (unit: WriteUnit<'machine'>) =>
        Effect.gen(function* () {
          const current = yield* intents.obligation(unit, projectId, execution);
          if (current === null || current.discharged) return;
          const { holdings } = current;
          if (holdings.rootUse !== undefined) {
            const given = yield* Effect.result(
              uses.release(unit, { useId: holdings.rootUse, consumer, outcome: proved ? 'completed' : 'abandoned' }),
            );
            if (given._tag === 'Failure') {
              if (proved) return yield* Effect.fail(given.failure);
              yield* Effect.logWarning('an ending whose use the ledger refused kept its root reservation; its custody ends anyway', {
                execution: execution.execution,
                useId: holdings.rootUse,
                refusal: given.failure._tag,
              });
            }
          }
          if (holdings.environmentUse !== undefined) {
            const given = yield* Effect.result(
              environments.release(unit, holdings.environmentUse, consumer, proved ? 'cleanup-confirmed' : 'abandoned'),
            );
            if (given._tag === 'Failure') {
              if (proved) return yield* Effect.fail(given.failure);
              yield* Effect.logWarning('an ending whose use the ledger refused kept its environment use; its custody ends anyway', {
                execution: execution.execution,
                useId: holdings.environmentUse,
                refusal: given.failure._tag,
              });
            }
          }
          if (obligation.kind === 'terminal') {
            yield* intents.discharge(unit, execution);
          } else {
            yield* intents.dischargeCommand(unit, execution);
          }
        }),
    );
    yield* released(projectId, execution, 'execution-ended');
    return { _tag: 'Discharged' };
  });

  const disposition = Effect.fn('Terminals.disposition')(function* () {
    const retained = new Map<string, number>();
    const count = (reason: string) => retained.set(reason, (retained.get(reason) ?? 0) + 1);
    const generation = yield* Effect.result(hostLifecycle.generation());
    if (generation._tag === 'Failure') {
      yield* Effect.logWarning('the disposition pass did not run: the host would not say which generation it stands at', {
        reason: generation.failure._tag,
      });
      return { stamped: 0, discharged: 0, retained };
    }
    const rows = yield* Effect.result(
      Effect.gen(function* () {
        const terminals = yield* units.read((unit) => terminalRows.standing(unit));
        const commands = yield* units.read((unit) => commandRows.commandsStanding(unit));
        return [
          ...terminals.map((row) => ({ kind: 'terminal' as const, projectId: row.projectId, execution: row.execution })),
          ...commands.map((row) => ({ kind: 'command' as const, projectId: row.projectId, execution: row.execution })),
        ];
      }),
    );
    if (rows._tag === 'Failure') {
      yield* Effect.logWarning('the disposition pass did not run: the rows this installation still holds could not be read', {
        reason: rows.failure._tag,
      });
      return { stamped: 0, discharged: 0, retained };
    }
    const current = generation.success;
    const absentFrom = (reading: HeldReading) =>
      rows.success.filter((row) => row.execution.incarnation === current && reading.stateOf(row.execution) === undefined);
    const mirrored = yield* cell.held(false);
    const held = absentFrom(mirrored).length > 0 ? yield* cell.held(true) : mirrored;
    const absent = held.whole && current !== null ? absentFrom(held) : [];
    const ended = rows.success.filter((row) => held.stateOf(row.execution)?.phase === 'ended');
    const unproven: typeof absent = [];
    let discharged = 0;
    yield* Effect.forEach(
      [...ended, ...absent],
      (row): Effect.Effect<void> =>
        Effect.gen(function* () {
          const receipt = yield* Effect.result(host.ending(row.execution, true));
          if (receipt._tag === 'Failure') {
            count(receipt.failure._tag);
            return;
          }
          if (receipt.success === undefined) {
            if (held.stateOf(row.execution) === undefined) unproven.push(row);
            else count('unended');
            return;
          }
          const answer = yield* Effect.result(discharge(row.projectId, row.execution, receipt.success));
          if (answer._tag === 'Failure') {
            count(answer.failure._tag);
            return;
          }
          if (answer.success._tag === 'Discharged') {
            discharged += 1;
            return;
          }
          count(answer.success.reason);
          if (answer.success.reason === 'residual' && nameSurvivor(row.execution, receipt.success.residual)) {
            yield* Effect.logInfo('an ended execution keeps its custody: a residual process still stands', {
              execution: row.execution.execution,
              incarnation: row.execution.incarnation,
              residual: receipt.success.residual,
            });
          }
        }),
      { concurrency: 4, discard: true },
    );
    const commands = unproven.filter((row) => row.kind === 'command').map((row) => row.execution);
    const asked = commands.length === 0 ? undefined : yield* Effect.result(hostCommands.commandsAt(commands));
    let refused: string | null = null;
    if (asked?._tag === 'Failure') refused = asked.failure._tag;
    const batch = asked?._tag === 'Success' ? asked.success : undefined;
    const admitted = new Map<string, string>(batch?.commands.map((entry) => [entry.state.ref.execution, entry.state.phase]));
    const unmeasured = (batch?.unmeasured.length ?? 0) > 0;
    let stamped = 0;
    let failed: string | null = null;
    const retired = unproven.filter((row) => {
      if (row.kind !== 'command') return true;
      if (refused !== null) {
        count(refused);
        return false;
      }
      const phase = admitted.get(row.execution.execution);
      if (phase === undefined && unmeasured) {
        count('host-unmeasured');
        return false;
      }
      if (phase === undefined || phase === 'ended') return true;
      count(`host-${phase}`);
      return false;
    });
    for (const row of retired) {
      const written = yield* Effect.result(abandonAndDischarge(row.kind, row.execution, 'execution-ended'));
      if (written._tag === 'Failure') {
        count(written.failure._tag);
        failed ??= written.failure._tag;
      } else stamped += 1;
    }
    if (failed !== null) {
      yield* Effect.logWarning(`${retired.length - stamped} rows the host retired were not stamped out of the standing listing`, {
        reason: failed,
      });
    } else if (stamped > 0) {
      yield* Effect.log(`${stamped} terminal row${stamped === 1 ? '' : 's'} the host retired left the standing listing`);
    }
    if (stamped > 0 || discharged > 0 || retained.size > 0) {
      yield* Effect.log('the disposition pass ran', {
        stamped,
        discharged,
        retained: Object.fromEntries(retained),
      });
    }
    return { stamped, discharged, retained };
  });

  const nameSurvivor = (execution: ExecutionRef, residual: readonly { readonly pid?: number }[]): boolean => {
    if (!residual.some((row) => row.pid !== undefined)) return false;
    const key = refKey(execution);
    if (namedSurvivors.has(key)) return false;
    namedSurvivors.add(key);
    return true;
  };

  return {
    retire,
    disown,
    disownThreads,
    disownProject,
    disownGone,
    ended,
    dischargeReplaced,
    sweepReplaced,
    abandonAndDischarge,
    discharge,
    disposition,
  };
});

export const sweepKeyOf = (
  projectId: number,
  operationId: HostRequestKey,
  requester: Principal,
  owners: readonly CommandSubject[],
): TerminalOperationKey => ({
  projectId,
  operationId,
  requester,
  mutation: 'sweep',
  targetKey: TargetKey.make(`sweep:${createHash('sha256').update(owners.map(subjectKeyOf).sort().join('\n')).digest('hex')}`),
});
