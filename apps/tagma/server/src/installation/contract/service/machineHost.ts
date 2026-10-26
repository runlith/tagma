import { Context, type Effect } from 'effect';
import type { MachineState } from '../wire/machine.js';

export class MachineHost extends Context.Service<
  MachineHost,
  {
    readonly standing: Effect.Effect<MachineState['host']>;
  }
>()('tagma/installation/MachineHost') {}
