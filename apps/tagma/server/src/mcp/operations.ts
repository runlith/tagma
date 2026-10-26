import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { McpServers } from './contract/service/servers.js';
import { MCP_APP_OPERATIONS as APPS, MCP_OPERATIONS as OPS, mcpScopeOf } from './contract/wire/operations.js';
import type { McpServerRow } from './contract/wire/servers.js';

const answer = (mcp: readonly McpServerRow[]) => ({ status: 'ok' as const, mcp });

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const MCP_PAIRS = {
  read_mcp_servers: pair(
    OPS.read_mcp_servers,
    body(OPS.read_mcp_servers, {
      execute: Effect.fnUntraced(function* () {
        return answer(yield* (yield* McpServers).list(yield* projectId));
      }),
    }),
  ),
  add_mcp_server: pair(
    OPS.add_mcp_server,
    body(OPS.add_mcp_server, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        const { scope, enabled, project: _project, ...declared } = input;
        const declaration = { ...declared, enabled: enabled ?? true } as McpServerDeclaration;
        return answer(yield* (yield* McpServers).add({ projectId: yield* projectId, scope: mcpScopeOf(input), declaration }));
      }),
    }),
  ),
  enable_mcp_server: pair(
    OPS.enable_mcp_server,
    body(OPS.enable_mcp_server, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return answer(
          yield* (yield* McpServers).setEnabled({
            projectId: yield* projectId,
            scope: mcpScopeOf(input),
            name: input.name,
            enabled: input.enabled ?? true,
          }),
        );
      }),
    }),
  ),
  open_mcp_app: pair(
    APPS.open_mcp_app,
    body(APPS.open_mcp_app, {
      execute: Effect.fnUntraced(function* (input) {
        const mount = { projectId: yield* projectId, server: input.server, identity: input.identity };
        const view = yield* (yield* McpServers).appView(mount, input.resource, input.tool);
        return { status: 'ok' as const, view };
      }),
    }),
  ),
  read_mcp_resource: pair(
    APPS.read_mcp_resource,
    body(APPS.read_mcp_resource, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const read = yield* (yield* McpServers).appRead({ projectId: project, server: input.server, identity: input.identity }, input.uri, {
          kind: 'operator',
          projectId: project,
          view: input.resource,
        });
        return { status: 'ok' as const, ...read };
      }),
    }),
  ),
  call_mcp_app_tool: pair(
    APPS.call_mcp_app_tool,
    body(APPS.call_mcp_app_tool, {
      execute: Effect.fnUntraced(function* (input) {
        const project = yield* projectId;
        const mount = { projectId: project, server: input.server, identity: input.identity };
        const result = yield* (yield* McpServers).appCall(mount, input.tool, input.arguments, {
          kind: 'operator',
          projectId: project,
          view: input.resource,
          threadId: input.threadId,
        });
        return { status: 'ok' as const, result };
      }),
    }),
  ),
  remove_mcp_server: pair(
    OPS.remove_mcp_server,
    body(OPS.remove_mcp_server, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return answer(yield* (yield* McpServers).remove({ projectId: yield* projectId, scope: mcpScopeOf(input), name: input.name }));
      }),
    }),
  ),
};
