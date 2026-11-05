import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { type McpToolCaller, mcpToolCatalog } from '@runlith/mcp/mcpToolCatalog';
import { Effect } from 'effect';
import { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import { type PluginContribution, PluginPointRefused } from '../plugins/contract/service/points.js';
import { PluginTools, TOOLS } from './contract/service/tools.js';
import { pluginToolName, type ToolEntries, type ToolAudience } from './contract/wire/audience.js';

const MODEL_NAME_MAX = 64;

type Offered = {
  readonly plugin: string;
  readonly declaration: McpServerDeclaration;
  readonly audiences: ReadonlyMap<ToolAudience, readonly McpToolDescriptor[]>;
  readonly caller: McpToolCaller;
  readonly built: Map<string, ToolCatalog>;
};

type Assembled = { readonly revision: number; readonly enabled: readonly string[]; readonly catalog: ToolCatalog };

const refused = (reason: string) => new PluginPointRefused({ point: TOOLS.plugin.name, reason });

const declarationOf = (plugin: string, descriptors: readonly McpToolDescriptor[]): McpServerDeclaration => ({
  name: plugin,
  transport: 'stdio',
  command: plugin,
  capabilities: {
    kinds: [],
    mutates: true,
    tools: Object.fromEntries(
      descriptors.map((descriptor) => [descriptor.name, { kinds: [], mutates: descriptor.annotations?.readOnlyHint !== true }]),
    ),
  },
  enabled: true,
});

export const makeOffers = Effect.gen(function* () {
  const enabledPlugins = yield* EnabledPlugins;
  const offers = new Map<string, Offered>();
  const assembled = new Map<number, Assembled>();
  let revision = 0;

  const register = Effect.fn('PluginTools.register')(function* (
    contribution: PluginContribution<ToolEntries>,
  ): Effect.fn.Return<() => void, PluginPointRefused> {
    const { plugin, value, tools, caller } = contribution;
    if (value.length === 0) return () => undefined;
    if (tools === null) return yield* refused('tools are served by a process, and the plugin declares none');
    const served = new Map(tools.map((descriptor) => [descriptor.name, descriptor]));
    const missing = value.filter((entry) => !served.has(entry.name)).map((entry) => entry.name);
    if (missing.length > 0) return yield* refused(`the process serves no tool ${missing.join(', ')}`);
    const long = value.filter((entry) => pluginToolName(plugin.id, entry.name).length > MODEL_NAME_MAX).map((entry) => entry.name);
    if (long.length > 0)
      return yield* refused(`${long.join(', ')} named under ${plugin.id} pass the ${MODEL_NAME_MAX} characters a model accepts`);
    const audiences = new Map<ToolAudience, McpToolDescriptor[]>();
    for (const entry of value) {
      const listed = audiences.get(entry.audience) ?? [];
      listed.push(served.get(entry.name)!);
      audiences.set(entry.audience, listed);
    }
    const declaration = declarationOf(plugin.id, tools);
    const { excluded } = mcpToolCatalog({
      projectId: null,
      declaration,
      descriptors: [...(audiences.get('agents') ?? []), ...(audiences.get('own') ?? [])],
      pool: caller,
    });
    if (excluded.length > 0) {
      return yield* refused(
        `no agent can call ${excluded.map((tool) => `${tool.tool} (${tool.reason})`).join(', ')}; name it for the view`,
      );
    }
    const offered: Offered = {
      plugin: plugin.id,
      declaration,
      audiences,
      caller,
      built: new Map(),
    };
    offers.set(plugin.id, offered);
    revision += 1;
    return () => {
      if (offers.get(plugin.id) !== offered) return;
      offers.delete(plugin.id);
      revision += 1;
    };
  });

  const catalogOf = (plugin: string, audience: ToolAudience, projectId: number): ToolCatalog => {
    const offered = offers.get(plugin);
    if (offered === undefined) return {};
    const key = `${audience}\u0000${projectId}`;
    const standing = offered.built.get(key);
    if (standing !== undefined) return standing;
    const { tools } = mcpToolCatalog({
      projectId,
      declaration: offered.declaration,
      descriptors: offered.audiences.get(audience) ?? [],
      pool: offered.caller,
    });
    const catalog: ToolCatalog = Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [
        pluginToolName(plugin, name),
        audience === 'agents' ? { ...tool, exposure: 'deferred' as const } : tool,
      ]),
    );
    offered.built.set(key, catalog);
    return catalog;
  };

  const assemble = (projectId: number, enabled: readonly string[]): ToolCatalog => {
    const standing = assembled.get(projectId);
    if (standing !== undefined && standing.revision === revision && standing.enabled === enabled) return standing.catalog;
    const catalog: ToolCatalog = Object.assign({}, ...enabled.map((plugin) => catalogOf(plugin, 'agents', projectId)));
    assembled.set(projectId, { revision, enabled, catalog });
    return catalog;
  };

  return {
    ...PluginTools.of({
      of: (projectId) =>
        Effect.map(enabledPlugins.held(projectId), (enabled) => ({
          agents: () => assemble(projectId, enabled()),
          own: (plugin: string) => (enabled().includes(plugin) ? catalogOf(plugin, 'own', projectId) : {}),
          view: (plugin: string) => (enabled().includes(plugin) ? (offers.get(plugin)?.audiences.get('view') ?? []) : []),
        })),
    }),
    register,
  };
});
