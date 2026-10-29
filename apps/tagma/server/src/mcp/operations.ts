import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import { Effect } from 'effect';
import { body, pair } from '../platform/contract/service/body.js';
import { GateRefusal } from '../platform/contract/wire/refusal.js';
import { CurrentProject } from '../projects/contract/service/caller.js';
import { McpSignInDoor } from './contract/service/door.js';
import { McpServers } from './contract/service/servers.js';
import { MCP_CALLBACK_PATH } from './contract/wire/callback.js';
import {
  MCP_APP_OPERATIONS as APPS,
  MCP_OPERATIONS as OPS,
  MCP_SIGN_IN_OPERATIONS as SIGN_IN,
  mcpScopeOf,
} from './contract/wire/operations.js';
import { mcpRowsAt, type McpServerRow } from './contract/wire/servers.js';

const callback = Effect.map(McpSignInDoor, (door) => {
  const origin = door.origin();
  return origin === null ? null : `${origin}${MCP_CALLBACK_PATH}`;
});

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
  sign_in_mcp_server: pair(
    SIGN_IN.sign_in_mcp_server,
    body(SIGN_IN.sign_in_mcp_server, {
      execute: Effect.fnUntraced(function* (input) {
        const redirect = yield* callback;
        if (redirect === null) {
          return yield* new GateRefusal('mcp-sign-in-unserved', 'This door has no address yet that a sign-in could return to.', [
            'sign in once read_remote_access reports the door ready',
            'or sign in from the machine Tagma runs on',
          ]);
        }
        const started = yield* (yield* McpServers).signIn({
          projectId: yield* projectId,
          scope: mcpScopeOf(input),
          name: input.name,
          client: input.client,
          redirect,
        });
        return { status: 'ok' as const, url: started.url };
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
