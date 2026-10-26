import { Effect, Option } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { ProcessControl } from './ProcessControl';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
import { Processes, type ProcessReader } from './ProcessReader';

export type PidState = 'standing' | 'gone' | 'unreadable';

export const pidStanding = Effect.fnUntraced(function* (pid: number, reader?: ProcessReader): Effect.fn.Return<PidState> {
  const processes = reader ?? Option.getOrUndefined(yield* Effect.serviceOption(Processes));
  if (processes === undefined) return 'unreadable';
  const read = processes.identity(pid);
  return read._tag === 'Gone' ? 'gone' : read._tag === 'Unreadable' ? 'unreadable' : read.zombie ? 'gone' : 'standing';
});

export const killStray =
  (control: ProcessControl['Service'] | undefined) =>
  (witness: ProcessWitness, step: StopStep): Effect.Effect<boolean> =>
    control === undefined ? Effect.succeed(false) : Effect.map(control.act(witness, step), (sent) => sent === 'delivered');
