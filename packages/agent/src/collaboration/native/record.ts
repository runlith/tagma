import type { ModelCatalog } from '@runlith/llm/models/catalog';
import { admits } from '../../catalog/resolveCatalog';
import { agentTypeId, catalogProfileOf } from '../../thread/agents/AgentProfile';
import type { ThreadAgent } from '../../thread/agents/ThreadAgent';
import type { ThreadWriteTx } from '../../thread/ThreadPorts';
import type { AgentRegistry } from '../../thread/agents/AgentRegistry';
import { NATIVE_HARNESS, type ThreadRecord } from '../../thread/record';
import { servedAgentOf, type ThreadMetadataRow } from '../../thread/rows';
import { FINAL_ANSWER_TOOL } from '../../transcript/parts';
import { COLLABORATION_SOURCE } from '../CollaborationConfig';
import { modelOf } from './modelChoice';

export function holdsFinalAnswer(
  agent: { readonly grant: ThreadAgent<ThreadWriteTx>['grant'] },
  profile: ThreadMetadataRow['profile'],
): boolean {
  return admits({ grant: agent.grant }, catalogProfileOf(profile), COLLABORATION_SOURCE, FINAL_ANSWER_TOOL);
}

export function threadHoldsFinalAnswer(agents: AgentRegistry, row: ThreadMetadataRow): boolean {
  const served = servedAgentOf(row);
  const agent = served === null ? undefined : agents.find(served);
  return row.capabilities.messaging && (agent === undefined || holdsFinalAnswer(agent, row.profile));
}

export function recordOf(agents: AgentRegistry, models: ModelCatalog | null, row: ThreadMetadataRow): ThreadRecord {
  const model = modelOf(models, row);
  return {
    id: row.id,
    ...(row.projectId == null ? {} : { projectId: row.projectId }),
    principal: row.ownerId,
    agentId: row.agentId,
    typeId: agentTypeId(row.agentId, row.profile?.id ?? null, row.transport.agent),
    name: row.name,
    spawnRootId: row.spawnRootId,
    parentThreadId: row.parentThreadId,
    spawnedByRunId: row.spawnedByRunId,
    bornOf: row.bornOf,
    createdBy: row.createdBy,
    harness: row.transport.profile ?? NATIVE_HARNESS,
    host: row.hostKind !== null && row.hostId !== null ? { kind: row.hostKind, id: row.hostId } : null,
    authority: row.authority,
    plain: row.plain,
    budgetTokens: row.budgetTokens,
    capabilities: { ...row.capabilities, messaging: threadHoldsFinalAnswer(agents, row) },
    model: model === null ? null : { provider: row.provider, model, reasoning: row.reasoning },
    profile: row.profile?.id ?? null,
  };
}
