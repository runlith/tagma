import { Effect } from 'effect';
import { ThreadStorageFailed } from '@runlith/agent/thread/persisted';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { COMMAND_RESULT_SIGNAL } from '../../executions/contract/wire/commands.js';
import { CommandWaiters } from '../../executions/contract/service/commands.js';
import { CALL_RESULT_SIGNAL } from '../contract/wire/calls.js';
import { OwnWork } from '../contract/service/ownWork.js';
import { makeOwedCallRows } from '../store/owedCalls.js';

export const makeOwnWork = Effect.gen(function* () {
  const waiters = yield* CommandWaiters;
  const units = yield* MachineUnits;
  const calls = yield* makeOwedCallRows;
  return OwnWork.of({
    owing: Effect.fn('OwnWork.owing')(function* (threads) {
      const background = yield* units
        .read((unit) => calls.owing(unit, threads))
        .pipe(Effect.mapError((cause) => new ThreadStorageFailed({ call: 'OwnWork.calls', cause })));
      const commands = yield* Effect.mapError(
        waiters.owing(threads),
        (cause) => new ThreadStorageFailed({ call: 'OwnWork.commands', cause }),
      );
      return [...new Set([...background, ...commands])];
    }),
    endings: new Set([COMMAND_RESULT_SIGNAL, CALL_RESULT_SIGNAL]),
  });
});
