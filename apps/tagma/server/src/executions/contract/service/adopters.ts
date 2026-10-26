import { Context, type Effect, type Stream } from 'effect';

export class TerminalAdopters extends Context.Service<
  TerminalAdopters,
  {
    of(projectId: number, executions: readonly string[]): Effect.Effect<ReadonlyMap<string, string>>;
    readonly moves: Stream.Stream<void>;
  }
>()('tagma/executions/TerminalAdopters') {}
