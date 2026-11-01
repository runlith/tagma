import type { ToolCatalog } from '@runlith/agent/catalog';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import { type McpToolCaller, mcpToolCatalog } from '@runlith/mcp/mcpToolCatalog';
import { Effect } from 'effect';
import { Settings } from '../settings/contract/service/values.js';
import { type TagmaAppContribution, TagmaAppPointRefused } from './contract/service/points.js';
import { TagmaAppTools, TOOLS } from './contract/service/tools.js';
import { tagmaAppToolName, type ToolEntries, type ToolAudience } from './contract/wire/audience.js';
import { tagmaAppsEnabled } from './contract/wire/settings.js';

const MODEL_NAME_MAX = 64;

type Offered = {
  readonly app: string;
  readonly declaration: McpServerDeclaration;
  readonly audiences: ReadonlyMap<ToolAudience, readonly McpToolDescriptor[]>;
  readonly caller: McpToolCaller;
  readonly built: Map<string, ToolCatalog>;
};

type Assembled = { readonly revision: number; readonly enabled: readonly string[]; readonly catalog: ToolCatalog };

const refused = (reason: string) => new TagmaAppPointRefused({ point: TOOLS.app.name, reason });

const declarationOf = (app: string, descriptors: readonly McpToolDescriptor[]): McpServerDeclaration => ({
  name: app,
  transport: 'stdio',
  command: app,
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
  const settings = yield* Settings;
  const offers = new Map<string, Offered>();
  const assembled = new Map<number, Assembled>();
  let revision = 0;

  const register = Effect.fn('TagmaAppTools.register')(function* (
    contribution: TagmaAppContribution<ToolEntries>,
  ): Effect.fn.Return<() => void, TagmaAppPointRefused> {
    const { app, value, tools, caller } = contribution;
    if (value.length === 0) return () => undefined;
    if (tools === null) return yield* refused('tools are served by a process, and the app declares none');
    const served = new Map(tools.map((descriptor) => [descriptor.name, descriptor]));
    const missing = value.filter((entry) => !served.has(entry.name)).map((entry) => entry.name);
    if (missing.length > 0) return yield* refused(`the process serves no tool ${missing.join(', ')}`);
    const long = value.filter((entry) => tagmaAppToolName(app.id, entry.name).length > MODEL_NAME_MAX).map((entry) => entry.name);
    if (long.length > 0)
      return yield* refused(`${long.join(', ')} named under ${app.id} pass the ${MODEL_NAME_MAX} characters a model accepts`);
    const audiences = new Map<ToolAudience, McpToolDescriptor[]>();
    for (const entry of value) {
      const listed = audiences.get(entry.audience) ?? [];
      listed.push(served.get(entry.name)!);
      audiences.set(entry.audience, listed);
    }
    const declaration = declarationOf(app.id, tools);
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
      app: app.id,
      declaration,
      audiences,
      caller,
      built: new Map(),
    };
    offers.set(app.id, offered);
    revision += 1;
    return () => {
      if (offers.get(app.id) !== offered) return;
      offers.delete(app.id);
      revision += 1;
    };
  });

  const catalogOf = (app: string, audience: ToolAudience, projectId: number): ToolCatalog => {
    const offered = offers.get(app);
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
        tagmaAppToolName(app, name),
        audience === 'agents' ? { ...tool, exposure: 'deferred' as const } : tool,
      ]),
    );
    offered.built.set(key, catalog);
    return catalog;
  };

  const assemble = (projectId: number, enabled: readonly string[]): ToolCatalog => {
    const standing = assembled.get(projectId);
    if (standing !== undefined && standing.revision === revision && standing.enabled === enabled) return standing.catalog;
    const catalog: ToolCatalog = Object.assign({}, ...enabled.map((app) => catalogOf(app, 'agents', projectId)));
    assembled.set(projectId, { revision, enabled, catalog });
    return catalog;
  };

  return {
    ...TagmaAppTools.of({
      of: (projectId) =>
        Effect.map(settings.held(tagmaAppsEnabled, projectId), (enabled) => ({
          agents: () => assemble(projectId, enabled()),
          own: (app: string) => (enabled().includes(app) ? catalogOf(app, 'own', projectId) : {}),
          view: (app: string) => (enabled().includes(app) ? (offers.get(app)?.audiences.get('view') ?? []) : []),
        })),
    }),
    register,
  };
});
