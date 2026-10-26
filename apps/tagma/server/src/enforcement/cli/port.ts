import type { Effect } from 'effect';
import type { Invocation } from '../../platform/cli/verb.js';
import type { Performable } from '../../platform/contract/service/perform.js';
import type { DeclaredAnswer } from '../../platform/contract/wire/operation.js';

export type EnforcementCli = {
  readonly perform: (
    at: Invocation,
  ) => <D extends Performable>(declaration: D, input: D['input']['Type']) => Effect.Effect<DeclaredAnswer<D['answer']>, unknown>;
  readonly baseUrl: (at: Invocation) => string;
};
