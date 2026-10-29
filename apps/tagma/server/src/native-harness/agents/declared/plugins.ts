import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { ThreadCallBroke } from '@runlith/agent/thread/ThreadBorder';
import { Effect } from 'effect';
import { EnabledPlugins, type LoadedAgent } from '../../../plugins/contract/service/plugins.js';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';

export const makePluginAgents = Effect.fnUntraced(function* () {
  const plugins = yield* EnabledPlugins;
  const declared = (projectId: number) =>
    Effect.map(plugins.of(projectId).pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))), (loaded) =>
      loaded.flatMap((plugin) => plugin.agents),
    );
  const fileOf = (agent: LoadedAgent) =>
    Effect.map(agent.prompt.pipe(Effect.mapError((cause) => new ThreadCallBroke({ cause }))), (prompt): AgentFile => ({
      id: agent.name,
      description: agent.description,
      extends: undefined,
      capabilities: undefined,
      tools: agent.tools ?? undefined,
      model: undefined,
      sections: undefined,
      body: prompt,
      path: agent.file,
      directory: dirname(agent.file),
      origin: 'plugin',
      revision: createHash('sha256').update(prompt).digest('hex'),
      source: prompt,
    }));
  return {
    agentsIn: (projectId) => Effect.flatMap(declared(projectId), (agents) => Effect.forEach(agents, fileOf)),
    agentIn: (projectId, typeId) =>
      Effect.flatMap(declared(projectId), (agents) => {
        const named = agents.find((agent) => agent.name === typeId);
        return named === undefined ? Effect.succeed(undefined) : fileOf(named);
      }),
  } satisfies AgentPackages;
});
