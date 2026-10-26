import { RequestKey } from '../../platform/contract/wire/ids.js';
import type { AcquiredEnvironment } from '../../workspace/contract/service/environments.js';
import type { WorktreeRecovery, WorktreeRequest, WorktreeRevision } from '../contract/wire/creation.js';

export type PrepareCreationInput = {
  readonly intent: WorktreeRequest;
  readonly acquired: AcquiredEnvironment;
};

export type WorktreeExecution = {
  readonly operationId: RequestKey;
  readonly projectId: number;
  readonly acquired: AcquiredEnvironment;
};

export type WorktreeRecoveryRequest = {
  readonly operationId: RequestKey;
  readonly projectId: number;
  readonly observed: string;
  readonly acquired: AcquiredEnvironment;
};

export type WorktreeAdoption = {
  readonly recovery: WorktreeRecovery;
  readonly acquired: AcquiredEnvironment;
};

export type WorktreeAbandonment = {
  readonly operationId: RequestKey;
  readonly projectId: number;
  readonly revision: WorktreeRevision;
  readonly reason: string;
  readonly acquired: AcquiredEnvironment;
};
