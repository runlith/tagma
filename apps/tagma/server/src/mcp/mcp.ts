import { mcp as declaration } from './contract/wire/module.js';
import { Context } from 'effect';
import { lazyLayer, type LiveDeclaration, liveOf, manifest } from '../platform/contract/service/manifest.js';
import { DoorAddress } from '../platform/contract/service/door.js';
import { route } from '../platform/contract/service/route.js';
import { mcpCapability } from './contract/wire/capability.js';
import { McpServers } from './contract/service/servers.js';
import { MCP_CALLBACK_PATH } from './contract/wire/callback.js';
import { MCP_SETTING_SECTIONS, mcpClientDocument, mcpContributionsOff, mcpServers } from './contract/wire/settings.js';
import { MCP_FEEDS } from './contract/wire/feeds.js';
import { mcpServers as mcpServersSection } from './doctrine/mcpServers.js';

const live: LiveDeclaration<typeof MCP_FEEDS, McpServers | DoorAddress> = liveOf(MCP_FEEDS, async (door) =>
  (await import('./feeds.js')).mcpChannels(Context.get(door, McpServers), Context.get(door, DoorAddress)),
);

const callback = route({
  path: MCP_CALLBACK_PATH,
  preAdmitted: true,
  handler: async (door: Context.Context<McpServers>) => (await import('./callback.js')).callbackHandler(Context.get(door, McpServers)),
});

export const mcp = manifest({
  ...declaration,
  capabilities: [mcpCapability],
  bodies: async () => Object.values((await import('./operations.js')).MCP_PAIRS),
  presentation: async () => (await import('./presentation.js')).MCP_PRESENTATION,
  live,
  routes: [callback],
  settings: [mcpServers, mcpContributionsOff, mcpClientDocument],
  settingSections: MCP_SETTING_SECTIONS,
  sections: [
    { id: 'mcp-servers', place: { prompt: 200 }, owner: 'mcp', render: mcpServersSection, path: 'src/mcp/doctrine/mcpServers.ts' },
  ],
  lifetimes: {
    installation: lazyLayer(
      () => import('./serverPool.js'),
      ({ mcpServersLayer }) => mcpServersLayer(),
    ),
    serving: lazyLayer(
      () => import('./waits.js'),
      ({ waitsLayer }) => waitsLayer,
    ),
    call: (input: { readonly mcpServers: McpServers['Service'] }) => Context.make(McpServers, input.mcpServers),
  },
});
