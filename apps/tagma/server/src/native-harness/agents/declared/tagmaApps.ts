import { dirname, join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { ThreadBorderFailed } from '@runlith/agent/thread/ThreadBorder';
import type { ThreadToolSourceRegistry } from '@runlith/agent/thread/ThreadPorts';
import { Effect, FileSystem } from 'effect';
import { stored } from '../../../platform/store/crossing.js';
import { ContributionPoint } from '../../../platform/contract/service/contribution.js';
import { type TagmaAppContribution, TagmaAppPointRefused, type TagmaAppRef } from '../../../tagma-apps/contract/service/points.js';
import { tagmaAppsEnabled } from '../../../tagma-apps/contract/wire/settings.js';
import { Settings } from '../../../settings/contract/service/values.js';
import type { AgentPackages } from '../../../threads/contract/service/library.js';
import type { AgentFile } from '../../../threads/contract/wire/agentLibrary.js';
import type { Capability, CapabilitySource } from '../../capabilities/contract.js';
import type { CapabilityDefinitions } from '../../capabilities/definitions.js';
import { TagmaAppAgentEntries, type TagmaAppAgentEntry, tagmaAppAgentId, tagmaAppCapability } from '../../contract/wire/tagmaAppAgents.js';
import { capabilitySource } from '../capabilitySources.js';
import { namable } from './agentFiles.js';
import { parseAgentFile } from './files.js';

const OWNER = 'native-harness';

export const TAGMA_APP_AGENTS = new ContributionPoint<never, TagmaAppAgentEntries>('native-harness/tagma-app-agents', {
  name: 'agents',
  schema: TagmaAppAgentEntries,
});

const refused = (reason: string) => new TagmaAppPointRefused({ point: TAGMA_APP_AGENTS.app.name, reason });

export type TagmaAppAgentsInput = { readonly capabilities: CapabilityDefinitions; readonly sources: ThreadToolSourceRegistry };

export const makeTagmaAppAgents = Effect.fnUntraced(function* ({ capabilities, sources }: TagmaAppAgentsInput) {
  const settings = yield* Settings;
  const held = new Map<string, readonly AgentFile[]>();
  const byId = new Map<string, { readonly app: string; readonly file: AgentFile }>();

  const enabledIn = (projectId: number): Effect.Effect<readonly string[], ThreadBorderFailed> =>
    Effect.map(stored('appsEnabled')(settings.held(tagmaAppsEnabled, projectId)), (reading) => reading());

  const register = Effect.fnUntraced(function* ({ app, value }: TagmaAppContribution<TagmaAppAgentEntries>) {
    if (value.length === 0) return () => undefined;
    const id = tagmaAppCapability(app.id);
    const source: CapabilitySource = { id, names: [], tools: (ctx) => ctx.tagmaApps.own(app.id) };
    const capability: Capability = {
      id,
      description: `the tools ${app.title} gives its own agents`,
      sections: [],
      explicit: true,
      source,
    };
    const known = [...namable(capabilities), id];
    const agents: AgentFile[] = [];
    for (const entry of value) agents.push(yield* read(app, entry, known, id));
    const withdrawCapability = yield* capabilities.register(OWNER, capability).pipe(Effect.mapError((cause) => refused(cause.message)));
    const withdrawSource = yield* sources.register(capabilitySource(capability, source)).pipe(
      Effect.mapError((cause) => refused(cause.message)),
      Effect.tapError(() => Effect.sync(withdrawCapability)),
    );
    held.set(app.id, agents);
    for (const file of agents) byId.set(file.id, { app: app.id, file });
    return () => {
      if (held.get(app.id) === agents) held.delete(app.id);
      for (const file of agents) if (byId.get(file.id)?.file === file) byId.delete(file.id);
      withdrawSource();
      withdrawCapability();
    };
  });

  const packages: AgentPackages = {
    agentsIn: (projectId) => Effect.map(enabledIn(projectId), (enabled) => enabled.flatMap((app) => held.get(app) ?? [])),
    agentIn: (projectId, typeId) => {
      const named = byId.get(typeId);
      if (named === undefined) return Effect.succeed(undefined);
      return Effect.map(enabledIn(projectId), (enabled) => (enabled.includes(named.app) ? named.file : undefined));
    },
  };

  return { register, packages };
});

function read(
  app: TagmaAppRef,
  entry: TagmaAppAgentEntry,
  known: readonly string[],
  capability: string,
): Effect.Effect<AgentFile, TagmaAppPointRefused> {
  const path = join(app.root, entry.path);
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(path).pipe(Effect.mapError(() => refused(`${entry.path} is unreadable`)));
    const parsed = parseAgentFile(tagmaAppAgentId(app.id, entry.id), raw, known);
    if ('reason' in parsed) return yield* refused(`${entry.path}: ${parsed.reason}`);
    if (parsed.capabilities === undefined) {
      return yield* refused(`${entry.path}: an app agent names its capabilities, and ${capability} is added to them`);
    }
    const capabilities = parsed.capabilities.includes(capability) ? parsed.capabilities : [...parsed.capabilities, capability];
    return { ...parsed, capabilities, path, directory: dirname(path), origin: 'app' as const };
  }).pipe(Effect.provide(BunFileSystem.layer));
}
