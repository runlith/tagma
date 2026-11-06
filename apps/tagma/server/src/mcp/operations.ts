import type { McpCaller } from '@runlith/mcp/caller';
import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { DoorAddress } from '../platform/contract/service/door.js';
import { callbackOf, servedCallback } from './contract/service/door.js';
import { McpServers } from './contract/service/servers.js';
import {
  MCP_APP_OPERATIONS as APPS,
  MCP_CONTRIBUTED_OPERATIONS as CONTRIBUTED,
  MCP_OPERATIONS as OPS,
  MCP_SIGN_IN_OPERATIONS as SIGN_IN,
  mcpScopeOf,
} from './contract/wire/operations.js';
import { mcpRowsAt, type McpServerRow } from './contract/wire/servers.js';

const callback = Effect.map(DoorAddress, callbackOf);

const answer = (rows: readonly McpServerRow[]) => Effect.map(callback, (at) => ({ status: 'ok' as const, mcp: mcpRowsAt(rows, at) }));

const projectId = Effect.map(Effect.flatten(CurrentProject), (call) => call.project.id);

export const MCP_PAIRS = {
  read_mcp_servers: pair(
    OPS.read_mcp_servers,
    body(OPS.read_mcp_servers, {
      execute: Effect.fnUntraced(function* () {
        return yield* answer(yield* (yield* McpServers).list(yield* projectId));
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
        return yield* answer(yield* (yield* McpServers).add({ projectId: yield* projectId, scope: mcpScopeOf(input), declaration }));
      }),
    }),
  ),
  enable_mcp_server: pair(
    OPS.enable_mcp_server,
    body(OPS.enable_mcp_server, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return yield* answer(
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
  call_contributed_tool: pair(
    CONTRIBUTED.call_contributed_tool,
    body(CONTRIBUTED.call_contributed_tool, {
      execute: Effect.fnUntraced(function* (input, _prepared, caller) {
        const project = yield* projectId;
        const own = caller.actor.kind === 'external' ? caller.actor.plugin : null;
        const viewed = caller.actor.kind === 'operator' && input.plugin !== undefined && input.view !== undefined;
        const contributor = own ?? (viewed ? input.plugin : undefined);
        if (contributor === undefined || contributor === null) {
          return yield* new GateRefusal('mcp-plugin-unnamed', 'call_contributed_tool calls for a plugin, and this call names none.', [
            'call from the plugin’s process as plugin:<id>, or name the plugin and view of the calling view',
          ]);
        }
        const mcpCaller: McpCaller =
          own === null
            ? { kind: 'operator', projectId: project, view: `${contributor}/${input.view}`, threadId: input.threadId }
            : { kind: 'tagma', projectId: project, reason: `plugin ${contributor}` };
        const result = yield* (yield* McpServers).contributedCall({
          projectId: project,
          contributor,
          server: input.server,
          tool: input.tool,
          args: input.arguments,
          caller: mcpCaller,
        });
        return { status: 'ok' as const, result };
      }),
    }),
  ),
  sign_in_mcp_server: pair(
    SIGN_IN.sign_in_mcp_server,
    body(SIGN_IN.sign_in_mcp_server, {
      execute: Effect.fnUntraced(function* (input) {
        const redirect = yield* servedCallback;
        const started = yield* (yield* McpServers).signIn({
          projectId: yield* projectId,
          scope: mcpScopeOf(input),
          name: input.name,
          client: input.client,
          redirect,
        });
        return { status: 'ok' as const, url: started.url, skipped: started.skipped };
      }),
    }),
  ),
  sign_out_mcp_server: pair(
    SIGN_IN.sign_out_mcp_server,
    body(SIGN_IN.sign_out_mcp_server, {
      execute: Effect.fnUntraced(function* (input) {
        return yield* answer(
          yield* (yield* McpServers).signOut({ projectId: yield* projectId, scope: mcpScopeOf(input), name: input.name }),
        );
      }),
    }),
  ),
  remove_mcp_server: pair(
    OPS.remove_mcp_server,
    body(OPS.remove_mcp_server, {
      prepare: () => Effect.map(Effect.flatten(CurrentProject), (call) => call.project),
      execute: Effect.fnUntraced(function* (input) {
        return yield* answer(
          yield* (yield* McpServers).remove({ projectId: yield* projectId, scope: mcpScopeOf(input), name: input.name }),
        );
      }),
    }),
  ),
};
