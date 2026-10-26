import { Effect, Queue } from 'effect';
import type { InstallationId } from '@runlith/executions/protocol/execution';
import type { StoreDb } from '../../platform/contract/service/store.js';
import type { TerminalWatched } from '../contract/service/endings.js';
import type { InputWitness } from '../terminals/gridControl.js';
import type { TerminalDisplaced } from '../contract/service/custody.js';
import type { CommandWaiters } from '../contract/service/commands.js';
import { hostTerminals, terminalReconciliation } from './doubles.js';
import type { HostExecutions } from '../host/connection.js';
import { makeTerminalGrants } from '../terminals/grantBook.js';
import { makeTerminalInventory } from '../terminals/inventory.js';
import { makeTerminalTargets } from '../terminals/targets.js';
import { storesOver } from './stores.js';
import { waitersOver } from './waitersFixture.js';

export type GuardedFloor = Effect.Success<ReturnType<typeof guardedFloor>>;

export const guardedFloor = Effect.fnUntraced(function* ({
  port,
  guarded,
  db,
  installation,
  watched,
  capacity,
  witness,
  displaced,
  waiters,
}: {
  readonly port: HostExecutions;
  readonly guarded: HostExecutions;
  readonly db: StoreDb<'machine'>;
  readonly installation: InstallationId;
  readonly watched?: Queue.Queue<TerminalWatched>;
  readonly capacity?: number;
  readonly witness?: InputWitness;
  readonly displaced?: Queue.Queue<TerminalDisplaced>;
  readonly waiters?: CommandWaiters['Service'];
}) {
  const stores = storesOver(db, installation);
  const rows = {
    requestKeys: stores.requestKeys,
    intents: stores.intents,
    terminalRows: stores.terminalRows,
    commandRows: stores.commandRows,
    installation,
  };
  const grants = makeTerminalGrants({ executions: port, capacity });
  const targets = yield* makeTerminalTargets;
  const reconciliation = yield* terminalReconciliation({ ...rows, executions: port, grants });
  const terminals = yield* hostTerminals({
    ...rows,
    executions: guarded,
    targets,
    deliveries: stores.deliveries,
    grants,
    reconciliation,
    watched: watched ?? (yield* Queue.unbounded<TerminalWatched>()),
    cell: yield* makeTerminalInventory({ executions: guarded }),
    waiters: waiters ?? (yield* waitersOver(stores.deliveries)),
    witness,
    displaced,
  });
  return { terminals, targets, grants, reconciliation, stores };
});
