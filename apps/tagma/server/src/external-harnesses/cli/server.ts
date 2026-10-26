import type { Effect } from 'effect';
import type { Invocation } from '../../platform/cli/verb.js';

type Here = { readonly cwd: string };

export type OperationDoor = {
  readonly operations: {
    perform(request: {
      readonly params: { readonly id: string };
      readonly query: Here;
      readonly headers: Record<string, string | number | undefined>;
      readonly payload: unknown;
    }): Effect.Effect<unknown, unknown>;
  };
};

export type ServerCli = {
  readonly ask: <A>(call: (door: OperationDoor, at: Invocation) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>;
  readonly here: (at: Invocation) => Here;
};
