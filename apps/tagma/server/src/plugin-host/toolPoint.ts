import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { type McpToolCaller, mcpToolCatalog } from '@runlith/mcp/mcpToolCatalog';
import { Effect } from 'effect';
import { EnabledPlugins } from '../plugins/contract/service/plugins.js';
import { type PluginContribution, PluginPointRefused } from '../plugins/contract/service/points.js';
import { PluginTools, TOOLS } from './contract/service/tools.js';
import { pluginToolName, type ToolAudience, type ToolEntries, type ToolEntry } from './contract/wire/audience.js';

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

const descriptorOf = (entry: ToolEntry): McpToolDescriptor => ({
  name: entry.name,
  title: entry.annotations?.title,
  description: entry.description,
  inputSchema: entry.inputSchema,
  annotations: entry.annotations,
});

const declarationOf = (plugin: string, entries: ToolEntries): McpServerDeclaration => ({
  name: plugin,
  transport: 'stdio',
  command: plugin,
  capabilities: {
    kinds: [],
    mutates: true,
    tools: Object.fromEntries(entries.map((entry) => [entry.name, { kinds: [], mutates: entry.annotations?.readOnlyHint !== true }])),
  },
  enabled: true,
});

export const makeOffers = Effect.gen(function* () {
  const enabledPlugins = yield* EnabledPlugins;
  const offers = new Map<string, Offered>();
  const broken = new Set<string>();
  const assembled = new Map<number, Assembled>();
  let revision = 0;

  const register = Effect.fn('PluginTools.register')(function* (
    contribution: PluginContribution<ToolEntries>,
  ): Effect.fn.Return<() => void, PluginPointRefused> {
    const { plugin, value, caller } = contribution;
    const offered = value.filter((entry) => entry.audience !== 'tagma');
    if (offered.length === 0) return () => undefined;
    const long = offered.filter((entry) => pluginToolName(plugin.id, entry.name).length > MODEL_NAME_MAX).map((entry) => entry.name);
    if (long.length > 0)
      return yield* refused(`${long.join(', ')} named under ${plugin.id} pass the ${MODEL_NAME_MAX} characters a model accepts`);
    const audiences = new Map<ToolAudience, McpToolDescriptor[]>();
    for (const entry of offered) {
      const listed = audiences.get(entry.audience) ?? [];
      listed.push(descriptorOf(entry));
      audiences.set(entry.audience, listed);
    }
    const declaration = declarationOf(plugin.id, offered);
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
    const standing: Offered = { plugin: plugin.id, declaration, audiences, caller, built: new Map() };
    offers.set(plugin.id, standing);
    revision += 1;
    return () => {
      if (offers.get(plugin.id) !== standing) return;
      offers.delete(plugin.id);
      revision += 1;
    };
  });

  const catalogOf = (plugin: string, audience: ToolAudience, projectId: number): ToolCatalog => {
    const offered = offers.get(plugin);
    if (offered === undefined || broken.has(plugin)) return {};
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
    broken: (plugin: string, now: boolean): void => {
      if (broken.has(plugin) === now) return;
      if (now) broken.add(plugin);
      else broken.delete(plugin);
      revision += 1;
    },
  };
});

export type Offers = Effect.Success<typeof makeOffers>;
