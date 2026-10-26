import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadToolSourceRegistry } from '@runlith/agent/thread/ThreadPorts';
import { Effect, FileSystem } from 'effect';
import { stored } from '../../../platform/store/crossing.js';
import { type PluginContribution, type PluginPoint, PluginPointRefused, type PluginRef } from '../../../plugins/contract/service/points.js';
import { pluginsEnabled } from '../../../plugins/contract/wire/settings.js';
import { Settings } from '../../../settings/contract/service/values.js';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import type { Capability, CapabilitySource } from '../../capabilities/contract.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import { PluginAgentEntries, type PluginAgentEntry, pluginAgentId, pluginCapability } from '../../contract/wire/pluginAgents.js';
import { capabilitySource } from '../capabilitySources.js';
import { namable } from './agentFiles.js';
import { parseAgentFile } from './files.js';

const OWNER = 'native-harness';

const refused = (reason: string) => new PluginPointRefused({ point: 'agents', reason });

export type PluginAgentsInput = { readonly capabilities: CapabilityDefinitions; readonly sources: ThreadToolSourceRegistry };

export const makePluginAgents = Effect.fnUntraced(function* ({ capabilities, sources }: PluginAgentsInput) {
  const settings = yield* Settings;
  const held = new Map<string, readonly AgentFile[]>();
  const byId = new Map<string, { readonly plugin: string; readonly file: AgentFile }>();

  const enabledIn = (projectId: number): Effect.Effect<readonly string[], ThreadBorderFailed> =>
    Effect.map(stored('pluginsEnabled')(settings.held(pluginsEnabled, projectId)), (reading) => reading());

  const register = Effect.fnUntraced(function* ({ plugin, value }: PluginContribution<PluginAgentEntries>) {
    if (value.length === 0) return () => undefined;
    const id = pluginCapability(plugin.id);
    const source: CapabilitySource = { id, names: [], tools: (ctx) => ctx.plugins.own(plugin.id) };
    const capability: Capability = {
      id,
      description: `the tools ${plugin.title} gives its own agents`,
      sections: [],
      explicit: true,
      source,
    };
    const known = [...namable(capabilities), id];
    const agents: AgentFile[] = [];
    for (const entry of value) agents.push(yield* read(plugin, entry, known, id));
    const withdrawCapability = yield* capabilities.register(OWNER, capability).pipe(Effect.mapError((cause) => refused(cause.message)));
    const withdrawSource = yield* sources.register(capabilitySource(capability, source)).pipe(
      Effect.mapError((cause) => refused(cause.message)),
      Effect.tapError(() => Effect.sync(withdrawCapability)),
    );
    held.set(plugin.id, agents);
    for (const file of agents) byId.set(file.id, { plugin: plugin.id, file });
    return () => {
      if (held.get(plugin.id) === agents) held.delete(plugin.id);
      for (const file of agents) if (byId.get(file.id)?.file === file) byId.delete(file.id);
      withdrawSource();
      withdrawCapability();
    };
  });

  const point: PluginPoint<PluginAgentEntries> = { name: 'agents', owner: OWNER, schema: PluginAgentEntries, register };

  const packages: AgentPackages = {
    agentsIn: (projectId) => Effect.map(enabledIn(projectId), (enabled) => enabled.flatMap((plugin) => held.get(plugin) ?? [])),
    agentIn: (projectId, typeId) => {
      const named = byId.get(typeId);
      if (named === undefined) return Effect.succeed(undefined);
      return Effect.map(enabledIn(projectId), (enabled) => (enabled.includes(named.plugin) ? named.file : undefined));
    },
  };

  return { point, packages };
});

function read(
  plugin: PluginRef,
  entry: PluginAgentEntry,
  known: readonly string[],
  capability: string,
): Effect.Effect<AgentFile, PluginPointRefused> {
  const path = join(plugin.root, entry.path);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(path).pipe(Effect.mapError(() => refused(`${entry.path} is unreadable`)));
    const parsed = parseAgentFile(pluginAgentId(plugin.id, entry.id), raw, known);
    if ('reason' in parsed) return yield* refused(`${entry.path}: ${parsed.reason}`);
    if (parsed.capabilities === undefined) {
      return yield* refused(`${entry.path}: a plugin agent names its capabilities, and ${capability} is added to them`);
    }
    const capabilities = parsed.capabilities.includes(capability) ? parsed.capabilities : [...parsed.capabilities, capability];
    return { ...parsed, capabilities, path, directory: dirname(path), origin: 'plugin' as const };
  }).pipe(Effect.provide(BunFileSystem.layer));
}
