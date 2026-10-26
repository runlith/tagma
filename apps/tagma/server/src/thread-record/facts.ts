import { sql } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';
import { NATIVE_HARNESS } from '../platform/contract/wire/session.js';
import { threadRecord } from './store/table.js';

export const recordsAs = <Alias extends string>(alias: Alias) =>
  new QueryBuilder()
    .select({
      id: threadRecord.id,
      projectId: threadRecord.projectId,
      parentId: threadRecord.parentId,
      spawnRootId: threadRecord.spawnRootId,
      detachedFrom: threadRecord.detachedFrom,
      detachedAt: threadRecord.detachedAt,
      principalId: threadRecord.principalId,
      name: threadRecord.name,
      title: threadRecord.title,
      titleOrigin: threadRecord.titleOrigin,
      titleRevision: threadRecord.titleRevision,
      titleAskedInput: threadRecord.titleAskedInput,
      harness: sql<string | null>`nullif(${threadRecord.harness}, ${NATIVE_HARNESS})`.as('harness'),
      agentId: threadRecord.agentId,
      bornOf: threadRecord.bornOf,
      spawnedByRunId: threadRecord.spawnedByRunId,
      createdBy: threadRecord.createdBy,
      scopeBlockUuid: threadRecord.scopeBlockUuid,
      createdBySessionId: threadRecord.createdBySessionId,
      readerOrderAt: threadRecord.readerOrderAt,
      pinnedAt: threadRecord.pinnedAt,
      folderId: threadRecord.folderId,
      archivedAt: threadRecord.archivedAt,
      status: threadRecord.status,
      runningRunId: threadRecord.runningRunId,
      movedAt: threadRecord.movedAt,
      recap: threadRecord.recap,
      createdAt: threadRecord.createdAt,
    })
    .from(threadRecord)
    .as(alias);

export const recordFacts = recordsAs('thread_record_facts');
