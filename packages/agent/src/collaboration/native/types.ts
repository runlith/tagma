import { Effect, Layer } from 'effect';
import type { AgentRegistry } from '../../thread/agents/AgentRegistry';
import type { ThreadAgent } from '../../thread/agents/ThreadAgent';
import type { ThreadSpawnType } from '../../thread/agents/ThreadTypeCatalog';
import type { ThreadWriteTx } from '../../thread/ThreadPorts';
import { NATIVE_HARNESS } from '../../thread/record';
import { holdsFinalAnswer } from './record';
import { type ThreadTypeOffer, ThreadTypes } from '../types';
import { NATIVE_CAPABILITIES } from '../../thread/record';

function offerOf(agent: ThreadAgent<ThreadWriteTx>): ThreadTypeOffer {
  return {
    baseAgentId: agent.id,
    harness: NATIVE_HARNESS,
    capabilities: { ...NATIVE_CAPABILITIES, messaging: holdsFinalAnswer(agent, null) },
  };
}

export function agentTypes(agents: AgentRegistry): Layer.Layer<ThreadTypes> {
  return Layer.succeed(ThreadTypes, {
    resolve: ({ typeId }) =>
      Effect.sync(() => {
        const agent = agents.find(typeId);
        return agent === undefined ? null : offerOf(agent);
      }),
    offered: () =>
      Effect.sync(() =>
        agents.list().map((agent): ThreadSpawnType => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          baseAgentId: agent.id,
        })),
      ),
  });
}
