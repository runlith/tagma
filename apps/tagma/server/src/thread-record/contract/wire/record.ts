import type { ThreadBornOf } from '@runlith/agent/protocol/birth';
import type { ThreadStatus } from '@runlith/agent/thread/rows';
import type { HarnessId } from '../../../platform/contract/wire/session.js';
import type { ThreadId } from '../../../platform/contract/wire/thread.js';
import type { ThreadRecap } from './recap.js';
import type { TitleProvenance } from './title.js';

export type ThreadRelation = 'lineage' | 'subtree' | 'beyond';

export type ThreadRecordFacts = {
  readonly id: ThreadId;
  readonly projectId: number | null;
  readonly origin: 'scoped' | 'unscoped';
  readonly parentId: ThreadId | null;
  readonly spawnRootId: ThreadId;
  readonly detachedFrom: ThreadId | null;
  readonly detachedAt: Date | null;
  readonly principalId: string;
  readonly name: string | null;
  readonly title: string;
  readonly titleProvenance: TitleProvenance;
  readonly titleRevision: number;
  readonly harness: HarnessId;
  readonly agentId: string;
  readonly bornOf: ThreadBornOf | null;
  readonly spawnedByRunId: string | null;
  readonly createdBy: string | null;
  readonly scopeBlockUuid: string | null;
  readonly createdBySessionId: number | null;
  readonly readerOrderAt: Date;
  readonly pinnedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly status: ThreadStatus;
  readonly runningRunId: string | null;
  readonly recap: ThreadRecap | null;
  readonly createdAt: Date;
};
