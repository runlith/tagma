import { expect } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionId, HostRequestKey, InstallationId } from '@runlith/executions/protocol/execution';
import { CommandAccess } from '../contract/service/access.js';
import { ManagedCommands, type CommandSweep } from '../contract/service/commands.js';
import { TerminalRefused } from '../contract/wire/refusals.js';
import { sweepKeyOf } from '../terminals/discharge.js';
import { endHeldCommands } from './endHeld.js';

const unused = (): never => {
  throw new Error('this closure consumes the command sweep');
};
const execution = { installation: InstallationId.make('closing'), execution: ExecutionId.make('command'), incarnation: 1 };
const operation = HostRequestKey.make('close-work');
const key = sweepKeyOf(1, operation, Principal.make('operator'), []);
const empty: CommandSweep = { fences: [], stopped: [], standing: [], refused: [], unresolved: [] };
const close = (sweep: CommandSweep) =>
  endHeldCommands(
    ManagedCommands.of({
      record: unused,
      revise: unused,
      background: unused,
      foreground: unused,
      measured: unused,
      deadline: unused,
      wait: unused,
      bytes: unused,
      stop: unused,
      changes: unused,
      moves: unused,
      stopAll: () => Effect.succeed(sweep),
    }),
    CommandAccess.of({ prepare: unused, recheck: unused }),
  )({ projectId: 1, threadIds: ['thread'], cause: 'scope-closed', operation });

it.effect('closing thread work succeeds only when the command owner confirms that nothing remains', () =>
  Effect.gen(function* () {
    expect(yield* close(empty)).toEqual(empty);
    for (const sweep of [
      { ...empty, standing: [execution] },
      { ...empty, refused: [{ execution, refusal: new TerminalRefused({ reason: 'stale-authority', message: 'the holder changed' }) }] },
      { ...empty, unresolved: [key] },
    ]) {
      expect(yield* Effect.flip(close(sweep))).toMatchObject({ _tag: 'TerminalUnavailable', owner: 'host' });
    }
  }),
);
