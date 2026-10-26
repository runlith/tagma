import { Effect } from 'effect';
import type { RegistryCollision } from '../../registry/Registry';
import { makeAgentRegistry, type AgentRegistry } from '../agents/AgentRegistry';
import type { ThreadAgent } from '../agents/ThreadAgent';
import type { ThreadSources } from '../agents/supply';

export const noSources: ThreadSources = () => Effect.succeed([]);

export const registeredAgents = Effect.fnUntraced(function* <TWrite>(
  agents: readonly ThreadAgent<TWrite>[],
  owner: string,
): Effect.fn.Return<AgentRegistry<TWrite>, RegistryCollision> {
  const registry = yield* makeAgentRegistry<TWrite>();
  yield* Effect.forEach(agents, (agent) => registry.register(agent, owner), { discard: true });
  return registry;
});
