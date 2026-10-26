import type { Effect } from 'effect';
import type { EndedExecution } from '../wire/rootExecutions.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { RootUse } from '../../../workspace/contract/wire/uses.js';
import type { TerminalActor } from '../wire/terminals.js';

export type Unreachable = 'unknown' | 'stop-refused' | 'started-elsewhere';

export type RootExecution = {
  readonly use: RootUse;
  readonly shown: EndedExecution | null;
  readonly unreachable: Unreachable | null;
  readonly end: (operationId: string) => Effect.Effect<boolean, { readonly message: string }>;
  readonly discharged: Effect.Effect<boolean, { readonly message: string }>;
};

export type RootEnding = (
  projectId: number,
  rootId: RootId,
  requester: TerminalActor,
  uses: readonly RootUse[],
) => Effect.Effect<readonly RootExecution[], { readonly message: string }>;
