import { Effect } from 'effect';
import { offeredSources } from '../../catalog/resolveCatalog';
import { catalogProfileOf } from './AgentProfile';
import type { AgentRegistry } from './AgentRegistry';
import type { ThreadBorderFailed } from '../ThreadBorder';
import type { ThreadToolSourceTarget, ThreadToolSourceRegistry } from '../ThreadPorts';
import type { ThreadSources } from './supply';

export function admittedToolSources(
  agents: AgentRegistry,
  registry: ThreadToolSourceRegistry,
  request: ThreadToolSourceTarget,
): Effect.Effect<ThreadSources, ThreadBorderFailed> {
  return Effect.map(agents.get(request.thread.agentId), (agent): ThreadSources => {
    const offered = [...offeredSources({ grant: agent.grant }, catalogProfileOf(request.thread.profile))];
    return (context) => (offered.length === 0 ? Effect.succeed([]) : registry.offers({ ...request, context }, offered));
  });
}
