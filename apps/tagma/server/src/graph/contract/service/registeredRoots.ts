import { Context, type Effect } from 'effect';

export class RegisteredRoots extends Context.Service<
  RegisteredRoots,
  {
    joined(root: string): Effect.Effect<void>;
    left(root: string, others: readonly string[]): Effect.Effect<void>;
  }
>()('tagma/graph/RegisteredRoots') {}
