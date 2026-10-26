import { Effect } from 'effect';
import { declare, type Held } from '@runlith/held/Held';
import { HoldCut, HoldStalled } from '@runlith/held/failures';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { TerminalUnavailable } from '../contract/wire/refusals.js';
import { refKey } from './refs.js';

export const makeExecutionGate = () =>
  declare<ExecutionRef>({
    name: 'executions/terminal-act',
    owner: 'executions',
    rank: 470,
    key: refKey,
    concurrency: 1,
    threshold: '1 second',
    ceilings: {
      hold: '15 minutes',
      wait: '15 minutes',
      leaves: 'the act may have reached the host; read custody and input receipts before retrying',
    },
    external: { named: 'execution host', callsBack: false },
  });

export const inExecution = <A, E, R>(gate: Held<ExecutionRef>, execution: ExecutionRef, act: Effect.Effect<A, E, R>) =>
  gate.hold(execution, act).pipe(
    Effect.mapError((failure) =>
      failure instanceof HoldCut || failure instanceof HoldStalled
        ? new TerminalUnavailable({
            owner: 'host',
            message: `The execution act could not hold its gate (${failure._tag}); read the current custody and receipt before retrying.`,
          })
        : failure,
    ),
  );
