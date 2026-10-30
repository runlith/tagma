import Blocks from '@lucide/svelte/icons/blocks';
import { MCP_SERVER_LINK, type McpServerLinkTarget } from '@tagma/server/mcp/contract/wire/link';
import { PLUGIN_LINK, PLUGINS_FIND_LINK, type PluginLinkTarget, type PluginsFindTarget } from '@tagma/server/plugins/contract/wire/link';
import type { Resolver } from '@runlith/layer/key';
import { Router } from '@runlith/layer/Router';
import type { LinkKind } from '$lib/features/opening/Link.js';
import { Addresses } from '$lib/features/workspace/Addresses.js';
import { Workspace } from '$lib/features/workspace/Selection.svelte.js';
import { idOf, PLUGINS, type Place } from './place.js';

const WORDS = 'Open in Plugins';

async function opened(app: Resolver, projectId: number, place: Place): Promise<void> {
  const project = app.resolve(Workspace).find(projectId);
  if (project !== null) await app.resolve(Router).goto(app.resolve(Addresses).place(project.name, PLUGINS, idOf(place), null));
}

const plugins: LinkKind<PluginLinkTarget> = {
  kind: PLUGIN_LINK,
  what: (_app, link) => link.target.id,
  full: { words: WORDS, icon: Blocks, open: (app, link) => opened(app, link.target.projectId, { kind: 'plugin', id: link.target.id }) },
};

const servers: LinkKind<McpServerLinkTarget> = {
  kind: MCP_SERVER_LINK,
  what: (_app, link) => link.target.name,
  full: {
    words: WORDS,
    icon: Blocks,
    open: (app, { target }) =>
      opened(
        app,
        target.projectId,
        target.scope === 'contributed' && target.contributor !== null
          ? { kind: 'plugin', id: target.contributor }
          : { kind: 'server', scope: target.scope, name: target.name },
      ),
  },
};

const finds: LinkKind<PluginsFindTarget> = {
  kind: PLUGINS_FIND_LINK,
  what: (_app, link) => link.target.query,
  full: { words: WORDS, icon: Blocks, open: (app, link) => opened(app, link.target.projectId, { kind: 'find', query: link.target.query }) },
};

export const links = [plugins, servers, finds];
