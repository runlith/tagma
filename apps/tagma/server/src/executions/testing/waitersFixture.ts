import { Effect, Queue } from 'effect';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { CallDebts } from '../contract/service/notices.js';
import { makeCommandWaiters } from '../commands/waiters.js';
import type { CommandDeliveries } from '../store/deliveries.js';

const noDebts: CallDebts = { calls: writes('waitersFixture.calls', []), release: () => Effect.void };

export const waitersOver = Effect.fnUntraced(function* (
  deliveries: CommandDeliveries,
  ended?: Queue.Queue<ExecutionRef>,
  debts: CallDebts = noDebts,
) {
  const units = yield* MachineUnits;
  return yield* makeCommandWaiters({
    deliveries,
    ended: ended ?? (yield* Queue.unbounded<ExecutionRef>()),
    takeBack: Effect.succeed({ ...debts, retract: (_thread, _signalId, within) => units.write('waitersFixture.waitersOver', within) }),
  });
});
