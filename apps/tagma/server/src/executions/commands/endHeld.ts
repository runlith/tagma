import { Effect } from 'effect';
import type { HostRequestKey } from '@runlith/executions/protocol/execution';
import type { CancellationCause } from '@runlith/executions/protocol/call';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { principalOf } from '../terminals/principals.js';
import { type TerminalActor } from '../contract/wire/terminals.js';
import type { Unit } from '../../platform/contract/service/units.js';
import type { CommandAccess } from '../contract/service/access.js';
import type { CommandSweep, ManagedCommands } from '../contract/service/commands.js';
import type { TerminalFailure } from '../contract/service/terminals.js';
import { sweepKeyOf } from '../terminals/discharge.js';
import { TerminalUnavailable } from '../contract/wire/refusals.js';

const OPERATOR: TerminalActor = { _tag: 'Operator' };

export const endHeldCommands =
  (commands: ManagedCommands['Service'], access: CommandAccess['Service']) =>
  (input: {
    readonly projectId: number;
    readonly threadIds: readonly string[];
    readonly run?: string;
    readonly cause: CancellationCause;
    readonly operation: HostRequestKey;
  }): Effect.Effect<CommandSweep, TerminalFailure> => {
    const owners = input.threadIds.map((threadId) => ({ _tag: 'Thread', thread: ThreadId.make(threadId) }) as const);
    return commands
      .stopAll(
        input.projectId,
        owners,
        sweepKeyOf(input.projectId, input.operation, principalOf(OPERATOR), owners),
        (execution) =>
          Effect.flatMap(access.prepare({ _tag: 'Stop', actor: OPERATOR, scope: input.projectId, execution }), (act) =>
            act.request._tag !== 'Stop'
              ? Effect.die(new Error('CommandAccess answered a Stop preparation with another act.'))
              : Effect.succeed({
                  prepared: { ...act, request: act.request },
                  recheck: (unit: Unit<'machine'>) => access.recheck(unit, act),
                }),
          ),
        input.cause,
        'signal',
        input.run,
      )
      .pipe(
        Effect.flatMap((sweep) =>
          sweep.standing.length === 0 && sweep.refused.length === 0 && sweep.unresolved.length === 0
            ? Effect.succeed(sweep)
            : Effect.fail(
                new TerminalUnavailable({
                  owner: 'host',
                  message: `Command work remains: ${sweep.standing.length} commands still held, ${sweep.refused.length} stops refused, ${sweep.unresolved.length} starts unresolved.`,
                }),
              ),
        ),
      );
  };
