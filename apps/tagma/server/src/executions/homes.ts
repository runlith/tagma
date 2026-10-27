import { and, eq, or } from 'drizzle-orm';
import { Effect } from 'effect';
import { MachineStore } from '../platform/contract/service/store.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import type { HomeFollowing } from '../thread-record/contract/service/homes.js';
import { commandRule } from './store/commandRule.js';
import { command, commandWait, terminal, terminalIntent } from './store/terminal.js';

const named = (row: { readonly execution: string; readonly label: string | null; readonly commandLine: string | null }): string =>
  `${row.label ?? row.commandLine ?? 'an execution'} (${row.execution})`;

export const executionHomes: HomeFollowing = {
  tables: [commandRule],
  admit: Effect.fn('Executions.admitHome')(function* (unit, move) {
    const { db } = yield* MachineStore;
    const held = yield* unit.run(
      db
        .select({ execution: terminal.executionId, label: terminal.label, commandLine: terminal.commandLine })
        .from(terminal)
        .where(eq(terminal.heldByThread, move.threadId))
        .all(),
    );
    const running = yield* unit.run(
      db
        .select({ execution: command.executionId, label: command.label, commandLine: command.commandLine })
        .from(command)
        .innerJoin(commandWait, and(eq(commandWait.executionId, command.executionId), eq(commandWait.incarnation, command.incarnation)))
        .where(eq(command.ownerThread, move.threadId))
        .all(),
    );
    const handing = yield* unit.run(
      db
        .select({ operation: terminalIntent.operationId })
        .from(terminalIntent)
        .where(or(eq(terminalIntent.outgoingThread, move.threadId), eq(terminalIntent.incomingThread, move.threadId)))
        .all(),
    );
    if (held.length === 0 && running.length === 0 && handing.length === 0) return;
    const holding = [...held, ...running].map(named);
    return yield* new GateRefusal(
      'executions-held',
      `Thread ${move.threadId} holds work running in project ${move.from}${
        holding.length === 0 ? '' : `: ${holding.join(', ')}`
      }${handing.length === 0 ? '' : `${holding.length === 0 ? ':' : ';'} a custody handover of it is undecided`}. An execution stays with the project it runs in, so the thread keeps its home.`,
      [
        'wait for it to end, or stop it — stop_terminal, stop_command',
        'hand it to the operator — transfer_terminal without `thread`',
        'then move the thread again',
      ],
    );
  }),
  follow: Effect.fn('Executions.followHome')(function* (unit, move) {
    const { db } = yield* MachineStore;
    yield* unit.run(
      db
        .update(commandRule)
        .set({ projectId: move.to })
        .where(and(eq(commandRule.threadId, move.threadId), eq(commandRule.projectId, move.from))),
    );
  }),
};
