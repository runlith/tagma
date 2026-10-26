import { Context, type Effect } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';

import type { ProcessWitness } from '@runlith/executions/protocol/evidence';
export type ProcessState = 'standing' | 'gone' | 'changed' | 'unreadable';
export type ProcessDelivery = 'delivered' | 'gone' | 'changed' | 'unreadable' | 'refused';

export class ProcessControl extends Context.Service<
  ProcessControl,
  {
    readonly standing: (witness: ProcessWitness) => Effect.Effect<ProcessState>;
    readonly act: (witness: ProcessWitness, step: StopStep) => Effect.Effect<ProcessDelivery>;
    readonly signal: (witness: ProcessWitness, name: string) => Effect.Effect<ProcessDelivery>;
  }
>()('@runlith/execution-host/ProcessControl') {}
