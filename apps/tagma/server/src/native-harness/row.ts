import { eq, sql, type SQL } from 'drizzle-orm';
import { QueryBuilder } from 'drizzle-orm/sqlite-core';
import { Effect } from 'effect';
import type { StoreDb } from '../platform/contract/service/store.js';
import { thread, threadRun } from '../threads/store/kernel.js';
import { recordsAs } from '../thread-record/facts.js';
import { mandateFacts } from '../threads/mandate.js';

const record = recordsAs('thread_row_record');

export const threadRowsAs = <Alias extends string>(alias: Alias) =>
  new QueryBuilder()
    .select({
      id: record.id,
      projectId: record.projectId,
      ownerId: sql<string>`${record.principalId}`.as('owner_id'),
      agentId: record.agentId,
      parentThreadId: sql<string | null>`${record.parentId}`.as('parent_thread_id'),
      spawnedByRunId: record.spawnedByRunId,
      bornOf: record.bornOf,
      spawnRootId: record.spawnRootId,
      cacheGroup: thread.cacheGroup,
      name: record.name,
      budgetTokens: mandateFacts.budgetTokens,
      profile: thread.profile,
      pendingDefinition: thread.pendingDefinition,
      authority: mandateFacts.authority,
      plain: mandateFacts.plain,
      hostKind: mandateFacts.hostKind,
      hostId: mandateFacts.hostId,
      bindings: mandateFacts.bindings,
      pendingInteraction: thread.pendingInteraction,
      account: thread.account,
      provider: thread.provider,
      model: thread.model,
      reasoning: thread.reasoning,
      switches: thread.switches,
      transport: thread.transport,
      capabilities: thread.capabilities,
      status: record.status,
      failureReason: thread.failureReason,
      contextReading: thread.contextReading,
      createdBy: record.createdBy,
      createdAt: record.createdAt,
      updatedAt: thread.updatedAt,
      systemPrompt: thread.systemPrompt,
      pendingSystemPrompt: thread.pendingSystemPrompt,
      contextEventId: thread.contextEventId,
      worldStateSnapshot: thread.worldStateSnapshot,
      worldStateCheckpointId: thread.worldStateCheckpointId,
    })
    .from(record)
    .innerJoin(mandateFacts, eq(mandateFacts.id, record.id))
    .innerJoin(thread, eq(thread.id, record.id))
    .as(alias);

export const threadRow = threadRowsAs('thread_row');

export const metadataColumns = {
  id: threadRow.id,
  projectId: threadRow.projectId,
  ownerId: threadRow.ownerId,
  agentId: threadRow.agentId,
  parentThreadId: threadRow.parentThreadId,
  spawnedByRunId: threadRow.spawnedByRunId,
  bornOf: threadRow.bornOf,
  spawnRootId: threadRow.spawnRootId,
  cacheGroup: threadRow.cacheGroup,
  name: threadRow.name,
  budgetTokens: threadRow.budgetTokens,
  profile: threadRow.profile,
  pendingDefinition: threadRow.pendingDefinition,
  authority: threadRow.authority,
  plain: threadRow.plain,
  hostKind: threadRow.hostKind,
  hostId: threadRow.hostId,
  bindings: threadRow.bindings,
  pendingInteraction: threadRow.pendingInteraction,
  account: threadRow.account,
  provider: threadRow.provider,
  model: threadRow.model,
  reasoning: threadRow.reasoning,
  switches: threadRow.switches,
  transport: threadRow.transport,
  capabilities: threadRow.capabilities,
  status: threadRow.status,
  failureReason: threadRow.failureReason,
  contextReading: threadRow.contextReading,
  createdBy: threadRow.createdBy,
  createdAt: threadRow.createdAt,
  updatedAt: threadRow.updatedAt,
};

export const rowColumns = {
  ...metadataColumns,
  systemPrompt: threadRow.systemPrompt,
  pendingSystemPrompt: threadRow.pendingSystemPrompt,
};

const storedRows = (db: StoreDb<'machine'>) => db.select(rowColumns).from(threadRow);

export type StoredRow = Effect.Success<ReturnType<typeof storedRows>>[number];

export const runFacts = new QueryBuilder()
  .select({ id: threadRun.id, threadId: threadRun.threadId })
  .from(threadRun)
  .as('thread_run_facts');

export const SCOPED_RUN: SQL = sql`exists (
  select 1 from ${recordsAs('scoped_run')} where "scoped_run"."id" = ${threadRun.threadId} and "scoped_run"."project_id" is not null
)`;
