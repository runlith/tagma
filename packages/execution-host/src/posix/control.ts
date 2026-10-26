import { Effect } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { ProcessControl, ProcessDelivery, ProcessState } from '../ProcessControl';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import type { ProcessReader } from '../ProcessReader';
import { sameProcess } from '@runlith/executions/protocol/evidence';

const signals: Readonly<Record<StopStep, NodeJS.Signals>> = {
  'hang-up': 'SIGHUP',
  interrupt: 'SIGINT',
  terminate: 'SIGTERM',
  kill: 'SIGKILL',
};

export const processControl = (reader: ProcessReader): ProcessControl['Service'] => {
  const standing = (witness: ProcessWitness): Effect.Effect<ProcessState> =>
    Effect.sync(() => {
      const read = reader.identity(witness.pid);
      return read._tag === 'Gone'
        ? 'gone'
        : read._tag === 'Unreadable'
          ? 'unreadable'
          : !sameProcess(read, witness)
            ? 'changed'
            : read.zombie
              ? 'gone'
              : 'standing';
    });
  const signal = (witness: ProcessWitness, name: string): Effect.Effect<ProcessDelivery> =>
    Effect.flatMap(standing(witness), (state) =>
      state !== 'standing'
        ? Effect.succeed(state)
        : Effect.sync(() => {
            try {
              process.kill(witness.pid, name as NodeJS.Signals);
              return 'delivered' as const;
            } catch (error) {
              const code = (error as NodeJS.ErrnoException).code;
              return code === 'ESRCH' ? 'gone' : 'refused';
            }
          }),
    );
  return { standing, signal, act: (witness, step) => signal(witness, signals[step]) };
};
