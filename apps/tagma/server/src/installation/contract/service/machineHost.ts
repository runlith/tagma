import { Context, type Effect, type Stream } from 'effect';
import type { MachineState } from '../wire/machine.js';
import type { HostEnding } from '../wire/newHost.js';

export class MachineHost extends Context.Service<
  MachineHost,
  {
    readonly standing: Effect.Effect<MachineState['host']>;
    readonly build: Effect.Effect<string | null>;
    readonly endings: Effect.Effect<ReadonlyArray<HostEnding> | null>;
    readonly stays: Effect.Effect<string | null>;
    readonly staying: Stream.Stream<string | null>;
  }
>()('tagma/installation/MachineHost') {}
