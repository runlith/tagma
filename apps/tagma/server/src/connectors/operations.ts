import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { servedCallback } from '../mcp/contract/service/door.js';
import { McpServers } from '../mcp/contract/service/servers.js';
import { ConnectorCatalog } from './contract/service/catalog.js';
import { CONNECTOR_OPERATIONS as OPS } from './contract/wire/operations.js';
import { connectorRow, connectorRows, declarationOf, declaredFrom } from './states.js';

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

const entryOf = Effect.fnUntraced(function* (id: string) {
  const entries = yield* (yield* ConnectorCatalog).entries;
  const entry = entries.find((candidate) => candidate.id === id);
  if (entry !== undefined) return entry;
  return yield* new GateRefusal('connector-unknown', `No connector in the catalog is called ${id}.`, [
    'read_connectors names every connector',
    'connect a service the catalog lacks by its URL with add_mcp_server',
  ]);
});

export const CONNECTOR_PAIRS = {
  read_connectors: pair(
    OPS.read_connectors,
    body(OPS.read_connectors, {
      execute: Effect.fnUntraced(function* () {
        const entries = yield* (yield* ConnectorCatalog).entries;
        const servers = yield* (yield* McpServers).list(yield* projectId);
        return { status: 'ok' as const, connectors: connectorRows(entries, servers) };
      }),
    }),
  ),
  connect_service: pair(
    OPS.connect_service,
    body(OPS.connect_service, {
      execute: Effect.fnUntraced(function* (input) {
        const entry = yield* entryOf(input.id);
        const project = yield* projectId;
        const scope = input.scope ?? 'project';
        const { signIn } = entry;
        const redirect = signIn.kind === 'oauth' ? yield* servedCallback : null;
        const servers = yield* McpServers;
        const standing = (yield* servers.list(project)).find((row) => row.name === entry.id);
        if (scope === 'user' && standing?.scope === 'project') {
          return yield* new GateRefusal(
            'mcp-server-exists',
            `This project declares its own ${entry.id}, which would stand in front of one declared for all projects.`,
            [`disconnect_service or remove_mcp_server the project's ${entry.id}, then connect`, 'or connect it for this project only'],
          );
        }
        yield* servers.add({ projectId: project, scope, declaration: declarationOf(entry), connector: entry.id });
        const declared = declaredFrom(
          entry,
          (yield* servers.raise(project, entry.id)).filter((row) => row.name === entry.id && row.scope === scope),
        );
        if (signIn.kind !== 'oauth' || redirect === null || declared?.status === 'connected' || declared?.status === 'declined') {
          return { status: 'ok' as const, connector: connectorRow(entry, declared) };
        }
        const client = signIn.client !== undefined && signIn.client.redirects.includes(redirect) ? { id: signIn.client.id } : undefined;
        const { url } = yield* servers.signIn({ projectId: project, scope, name: entry.id, client, redirect });
        return { status: 'ok' as const, connector: connectorRow(entry, declared), url };
      }),
    }),
  ),
  disconnect_service: pair(
    OPS.disconnect_service,
    body(OPS.disconnect_service, {
      execute: Effect.fnUntraced(function* (input) {
        const entry = yield* entryOf(input.id);
        const project = yield* projectId;
        const servers = yield* McpServers;
        const declared = declaredFrom(
          entry,
          (yield* servers.list(project)).filter((row) => input.scope === undefined || row.scope === input.scope),
        );
        if (declared === undefined) {
          return yield* new GateRefusal(
            'connector-unconnected',
            `No MCP server ${input.scope === undefined ? '' : `in ${input.scope} scope `}that this project resolves to was declared from ${entry.title}.`,
            ['read_connectors names the state of every connector here'],
          );
        }
        const rows = yield* servers.remove({ projectId: project, scope: declared.scope, name: declared.name });
        return { status: 'ok' as const, connector: connectorRow(entry, declaredFrom(entry, rows)) };
      }),
    }),
  ),
};
