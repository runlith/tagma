import { RequestKey } from '../../../platform/contract/wire/ids.js';
import { Context, type Effect } from 'effect';
import type { NamespaceId } from '@runlith/files/namespace';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { RepositoryId } from '../../../workspace/contract/wire/repositories.js';
import type { WorktreeIntent, WorktreeRevision } from '../wire/creation.js';
import type { WorktreeStoreFailure } from './worktrees.js';

type Machine = Unit<'machine'>;
type Write = WriteUnit<'machine'>;

export class WorktreeIntents extends Context.Service<
  WorktreeIntents,
  {
    byId(operationId: RequestKey, unit?: Machine): Effect.Effect<WorktreeIntent | null, WorktreeStoreFailure>;
    holders(
      namespaceId: NamespaceId,
      destination: string,
      repositoryId: RepositoryId,
      branch: string | null,
      unit: Write,
    ): Effect.Effect<readonly WorktreeIntent[], WorktreeStoreFailure>;
    insert(intent: WorktreeIntent, unit: Write): Effect.Effect<WorktreeIntent, StoreFailure>;
    move(intent: WorktreeIntent, from: WorktreeRevision, unit: Write): Effect.Effect<boolean, StoreFailure>;
  }
>()('tagma/worktrees/WorktreeIntents') {}
