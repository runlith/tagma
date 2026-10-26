import { Context, Effect, Layer } from 'effect';
import { threadEndHeld } from '../executions/ports.js';
import { CommandAccess } from '../executions/contract/service/access.js';
import { ManagedCommands } from '../executions/contract/service/commands.js';
import { Custody } from '../executions/contract/service/custody.js';
import { Discharge } from '../executions/contract/service/discharge.js';
import { ExecutionHistory } from '../executions/contract/service/history.js';
import type { StandingSweep } from '../platform/contract/service/maintenance.js';
import { Terminals } from '../executions/contract/service/terminals.js';
import { Worlds } from '../executions/contract/service/worlds.js';
import { terminalRefusal } from '../executions/terminals/refusal.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Sandboxes } from '../sandbox/contract/service/sandboxes.js';
import { SourceForgetting, ThreadTeardown } from './contract/service/engine.js';
import { launchedExecution } from './contract/wire/harness/externalSession.js';

export const historySweep =
  (history: ExecutionHistory['Service']): StandingSweep =>
  (moment) =>
    history.forgetGone().pipe(
      Effect.tap((forgotten) =>
        forgotten.commands + forgotten.terminals + forgotten.holds === 0
          ? Effect.void
          : Effect.logInfo('the history of deleted threads and released holds was forgotten', forgotten),
      ),
      Effect.catchTag('TerminalUnavailable', (failure) =>
        Effect.logWarning(`the history of deleted threads stays until the next pass (${moment})`, { reason: failure.message }),
      ),
      Effect.asVoid,
    );

export const threadTeardownLayer = Layer.effect(
  ThreadTeardown,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const units = yield* MachineUnits;
    const worlds = yield* Worlds;
    const sourceCache = yield* SourceForgetting;
    const sandboxes = yield* Sandboxes;
    const terminals = yield* Terminals;
    const custody = yield* Custody;
    const history = yield* ExecutionHistory;
    const executions = Context.make(Custody, custody).pipe(
      Context.add(Discharge, yield* Discharge),
      Context.add(Terminals, terminals),
      Context.add(ManagedCommands, yield* ManagedCommands),
      Context.add(CommandAccess, yield* CommandAccess),
    );
    const heldEnders = threadEndHeld({
      executions,
      units,
      named: (launched) => terminals.record(launched.execution, launched.incarnation),
    });
    return {
      endHeld: (threads, act) =>
        heldEnders.executions(
          threads.map((thread) => ({ id: thread.id, launched: thread.harness === null ? null : launchedExecution(thread.harness) })),
          act,
        ),
      endCommands: (input) =>
        heldEnders.commands(input).pipe(
          Effect.mapError((failure) => {
            const answered = terminalRefusal(failure);
            return new GateRefusal(
              'thread-commands-standing',
              `${input.threadIds.length === 1 ? `Thread ${input.threadIds[0]} stands` : `${input.threadIds.length} threads stand`} over commands that could not be ended — ${answered.code}: ${answered.reason}`,
              [
                'read this project’s command inventory and end what still stands with stop_command, then repeat the act',
                `read terminal operation ${input.operation}`,
                ...answered.unblock,
              ],
            );
          }),
          Effect.asVoid,
        ),
      afterDeleted: (threadIds, hosts) =>
        Effect.forEach(threadIds, (id) => worlds.drop(id).pipe(Effect.ensuring(sourceCache.forget(id))), { discard: true }).pipe(
          Effect.andThen(
            Effect.forkIn(
              custody.disownThreads(threadIds).pipe(
                Effect.andThen(history.forgetThreads(threadIds)),
                Effect.catchTag('TerminalUnavailable', (failure) =>
                  Effect.logWarning('the history of a deleted thread stays until the next pass', { reason: failure.message }),
                ),
              ),
              scope,
            ),
          ),
          Effect.andThen(
            Effect.forkIn(
              sandboxes.cleanup(hosts.filter((host) => host.kind === 'sandbox').map((host) => host.id)).pipe(
                Effect.catchTag('ThreadStorageFailed', (failure) => Effect.logWarning('sandbox cleanup after a deletion failed', failure)),
                Effect.asVoid,
              ),
              scope,
            ),
          ),
          Effect.asVoid,
        ),
    };
  }),
);
