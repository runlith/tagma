import { Context, type Effect, type Stream } from 'effect';
import type { LoadReader, MachineLoadFrame } from '../wire/load.js';
import type { TerminalFailure } from './terminals.js';

export class LoadFeed extends Context.Service<
  LoadFeed,
  {
    readonly machine: () => Stream.Stream<MachineLoadFrame, TerminalFailure>;
    readonly interest: (reader: LoadReader, interested: boolean) => Effect.Effect<boolean>;
  }
>()('tagma/executions/LoadFeed') {}
