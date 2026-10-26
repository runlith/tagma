import { Context, type Effect } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { HolderState } from '../wire/holders.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { CopyAim } from './serving.js';

export type HolderReading = (threadIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, HolderState>, StoreFailure>;

export class HolderStandings extends Context.Service<
  HolderStandings,
  {
    of: HolderReading;
    serve(reader: HolderReading): () => void;
  }
>()('tagma/graph/HolderStandings') {}

export type CopiesReading = (
  threadId: string,
  projectId: number,
) => Effect.Effect<readonly CopyAim[] | null, GateRefusal<'copies-unreadable'>>;

export class HolderCopies extends Context.Service<
  HolderCopies,
  {
    of: CopiesReading;
    serve(reader: CopiesReading): () => void;
  }
>()('tagma/graph/HolderCopies') {}
