import { RequestKey } from '../../../platform/contract/wire/ids.js';
import { Context, Data, type Schema, type Effect } from 'effect';
import type { EnvironmentVerdictFailure } from '../../../workspace/contract/wire/environments.js';
import type { RootId } from '../../../workspace/contract/wire/ids.js';
import type { CoveredRepositoriesFailure } from '../../../workspace/contract/service/repositories.js';
import type {
  ObservedCheckout,
  PREPARATION_FIELDS,
  WorktreeIntent,
  WorktreePreparation,
  WorktreeRecoveryPreparation,
  WorktreeRevision,
} from '../wire/creation.js';
import type { WorktreeFailure, WorktreeUnavailable } from '../wire/failures.js';

export type WorktreeCaller = {
  readonly projectId: number;
};

export type WorktreeCreationRequest = Schema.Struct<typeof PREPARATION_FIELDS>['Type'];

export type WorktreeFolder = (projectId: number) => Effect.Effect<string, WorktreeUnavailable>;

export class WorktreeHostUnreadable extends Data.TaggedError('WorktreeHostUnreadable')<{ readonly message: string }> {}

export type WorktreeActFailure = WorktreeFailure | EnvironmentVerdictFailure | WorktreeHostUnreadable | CoveredRepositoriesFailure;

export class Worktrees extends Context.Service<
  Worktrees,
  {
    prepare(caller: WorktreeCaller, request: WorktreeCreationRequest): Effect.Effect<WorktreePreparation, WorktreeActFailure>;
    create(caller: WorktreeCaller, operationId: RequestKey): Effect.Effect<WorktreeIntent, WorktreeActFailure>;
    read(caller: WorktreeCaller, operationId: RequestKey): Effect.Effect<WorktreeIntent, WorktreeActFailure>;
    reconcile(caller: WorktreeCaller, operationId: RequestKey): Effect.Effect<WorktreeIntent, WorktreeActFailure>;
    prepareRecovery(
      caller: WorktreeCaller,
      operationId: RequestKey,
      observed: string,
    ): Effect.Effect<WorktreeRecoveryPreparation, WorktreeActFailure>;
    adopt(
      caller: WorktreeCaller,
      operationId: RequestKey,
      revision: WorktreeRevision,
      observed: ObservedCheckout,
    ): Effect.Effect<WorktreeIntent, WorktreeActFailure>;
    abandon(
      caller: WorktreeCaller,
      operationId: RequestKey,
      revision: WorktreeRevision,
      reason: string,
    ): Effect.Effect<WorktreeIntent, WorktreeActFailure>;
    onRecorded(listener: (projectId: number, rootId: RootId) => void): () => void;
  }
>()('tagma/worktrees/Worktrees') {}
