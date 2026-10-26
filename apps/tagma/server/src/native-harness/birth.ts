import type { ThreadAuthority } from '@runlith/agent/thread/rows';
import type { ThreadInsertValues } from '@runlith/agent/thread/storage/aggregate';
import { Clock, Effect } from 'effect';
import type { ModelCatalog } from '@runlith/llm/models/catalog';
import type { StoreDb } from '../platform/contract/service/store.js';
import type { WriteUnit } from '../platform/contract/service/units.js';
import { nativeCapabilities } from '../threads/contract/wire/harness/seat.js';
import { thread } from '../threads/store/kernel.js';
import type { RecordBirth, ThreadRecords } from '../thread-record/contract/service/records.js';
import { insertMandate } from '../threads/mandate.js';

export type Birth = Omit<ThreadInsertValues, 'history' | 'transcript'> & {
  readonly id: string;
  readonly provider: string;
  readonly spawnRootId: string;
  readonly cacheGroup: string;
  readonly authority: ThreadAuthority;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
};

export const recordAtBirth = (birth: Birth): RecordBirth => ({
  id: birth.id,
  parentId: birth.parentThreadId ?? null,
  spawnRootId: birth.spawnRootId,
  principalId: birth.ownerId,
  name: birth.name ?? null,
  agentId: birth.agentId,
  bornOf: birth.bornOf ?? null,
  spawnedByRunId: birth.spawnedByRunId ?? null,
  createdBy: birth.createdBy ?? null,
  status: birth.status,
  createdAt: birth.createdAt ?? new Date(),
});

export const insertBirth = Effect.fnUntraced(function* (
  db: StoreDb<'machine'>,
  records: ThreadRecords['Service'],
  unit: WriteUnit<'machine'>,
  birth: Birth,
  models: ModelCatalog,
) {
  const born = { ...birth, createdAt: birth.createdAt ?? new Date(yield* Clock.currentTimeMillis) };
  yield* records.insert(unit, recordAtBirth(born));
  yield* unit.run(insertFacet(db, born, models));
});

export const insertFacet = Effect.fnUntraced(function* (db: StoreDb<'machine'>, birth: Birth, models: ModelCatalog) {
  const createdAt = birth.createdAt ?? new Date(yield* Clock.currentTimeMillis);
  yield* insertMandate(db, birth.id, {
    authority: birth.authority,
    plain: birth.plain ?? false,
    budgetTokens: birth.budgetTokens ?? null,
    hostKind: birth.hostKind ?? null,
    hostId: birth.hostId ?? null,
    bindings: birth.bindings,
  });
  yield* db.insert(thread).values({
    id: birth.id,
    cacheGroup: birth.cacheGroup,
    profile: birth.profile ?? null,
    pendingInteraction: birth.pendingInteraction ?? null,
    account: birth.account ?? null,
    provider: birth.provider,
    model: birth.model ?? null,
    reasoning: birth.reasoning ?? null,
    switches: birth.switches,
    transport: birth.transport,
    capabilities:
      birth.capabilities ??
      (birth.model == null || birth.provider === undefined ? undefined : nativeCapabilities(models, birth.provider, birth.model)),
    systemPrompt: birth.systemPrompt ?? null,
    pendingSystemPrompt: birth.pendingSystemPrompt ?? null,
    pendingDefinition: birth.pendingDefinition ?? null,
    failureReason: birth.failureReason ?? null,
    updatedAt: birth.updatedAt ?? createdAt,
  });
});
