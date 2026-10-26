import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpPalette } from '@runlith/mcp/McpPool';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { McpAppCallResult, McpAppTarget, McpAppView } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceResult } from '@runlith/mcp/resources';
import type { McpResourceEvent } from '../wire/feeds.js';
import { Context, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SettableScope } from '../../../platform/contract/wire/setting.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { McpServerRow } from '../wire/servers.js';

export type McpServerScopeInput = {
  readonly projectId: number;
  readonly scope: SettableScope;
};

export type McpReconcileRefusal = 'mcp-reconcile-stalled';
export type McpServerAddRefusal =
  | 'mcp-server-exists'
  | 'mcp-secret-missing'
  | McpReconcileRefusal
  | 'setting-scope'
  | 'setting-value'
  | 'unknown-project';
export type McpServerChangeRefusal = 'mcp-server-unknown' | McpReconcileRefusal | 'setting-scope' | 'setting-value' | 'unknown-project';

export class McpServers extends Context.Service<
  McpServers,
  {
    list(projectId: number): Effect.Effect<readonly McpServerRow[], StoreFailure>;
    add(
      input: McpServerScopeInput & { readonly declaration: McpServerDeclaration },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerAddRefusal | OpenRefusal>>;
    remove(
      input: McpServerScopeInput & { readonly name: string },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerChangeRefusal | OpenRefusal>>;
    setEnabled(
      input: McpServerScopeInput & { readonly name: string; readonly enabled: boolean },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerChangeRefusal | OpenRefusal>>;
    reconcile(projectId: number): Effect.Effect<void, StoreFailure | GateRefusal<McpReconcileRefusal>>;
    reconcileAll(): Effect.Effect<void, StoreFailure | GateRefusal<McpReconcileRefusal>>;
    palette(projectId: number): McpPalette;
    caller(projectId: number): McpToolCaller;
    release(projectId: number): Effect.Effect<void>;
    appView(mount: McpMount, resource: string, tool: string | undefined): Effect.Effect<McpAppView, McpViewFailure>;
    appRead(mount: McpMount, uri: string, caller: McpCaller): Effect.Effect<McpResourceResult, McpViewFailure>;
    appCall(
      mount: McpMount,
      tool: string,
      args: Readonly<Record<string, unknown>>,
      caller: McpCaller,
    ): Effect.Effect<McpAppCallResult, McpViewFailure>;
    appWatch(mount: McpMount, uri: string, caller: McpCaller): Stream.Stream<McpResourceEvent, McpViewFailure>;
  }
>()('tagma/mcp/McpServers') {}

export type McpMount = McpAppTarget & { readonly projectId: number };

export type McpViewRefusal =
  | 'mcp-server-unavailable'
  | 'mcp-server-replaced'
  | 'mcp-resource-failed'
  | 'mcp-tool-unoffered'
  | 'mcp-call-failed'
  | McpReconcileRefusal;

export type McpViewFailure = StoreFailure | GateRefusal<McpViewRefusal>;

export type McpServerResolution = {
  readonly declaration: McpServerDeclaration;
  readonly scope: SettableScope;
  readonly shadows?: SettableScope;
};
