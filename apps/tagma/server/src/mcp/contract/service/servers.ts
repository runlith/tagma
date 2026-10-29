import type { McpServerDeclaration } from '@runlith/mcp/declaration';
import type { McpPalette } from '@runlith/mcp/McpPool';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { McpAppCallResult, McpAppTarget, McpAppView } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceResult } from '@runlith/mcp/resources';
import type { McpResourceEvent } from '../wire/feeds.js';
import { Context, Data, type Effect, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { SettableScope } from '../../../platform/contract/wire/setting.js';
import type { GateRefusal, OpenRefusal } from '../../../platform/contract/wire/refusal.js';
import type { McpServerRow, McpServerScope } from '../wire/servers.js';

export type McpServerScopeInput = {
  readonly projectId: number;
  readonly scope: SettableScope;
};

export type McpServerSeenInput = {
  readonly projectId: number;
  readonly scope: McpServerScope;
};

export type McpListRefusal = 'secret-store-failed' | 'mcp-contributions-unreadable';
export type McpReconcileRefusal = 'mcp-reconcile-stalled' | McpListRefusal;
export type McpServerAddRefusal = 'mcp-server-exists' | McpReconcileRefusal | 'setting-scope' | 'setting-value' | 'unknown-project';
export type McpServerChangeRefusal = 'mcp-server-unknown' | McpReconcileRefusal | 'setting-scope' | 'setting-value' | 'unknown-project';
export type McpServerRemoveRefusal = McpServerChangeRefusal | 'mcp-server-contributed';
export type McpSignInRefusal = 'mcp-server-unknown' | 'mcp-sign-in-unsupported' | 'mcp-sign-in-failed' | McpReconcileRefusal;
export type McpSignOutRefusal = 'mcp-server-unknown' | McpReconcileRefusal;

export type McpOwnClient = { readonly id: string; readonly secret?: string };

export type McpSignInAnswer = {
  readonly state: string | null;
  readonly code: string | null;
  readonly iss: string | null;
  readonly error: string | null;
  readonly description: string | null;
};

export type McpSignInRejection = 'unknown' | 'forged' | 'refused' | 'failed';

export type McpSignedIn = { readonly server: string; readonly connected: boolean | null };

export class McpSignInRejected extends Data.TaggedError('McpSignInRejected')<{
  readonly rejection: McpSignInRejection;
  readonly reason: string;
  readonly server?: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

export class McpServers extends Context.Service<
  McpServers,
  {
    list(projectId: number): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpListRefusal>>;
    rows(projectId: number): Stream.Stream<readonly McpServerRow[], StoreFailure | GateRefusal<McpListRefusal>>;
    add(
      input: McpServerScopeInput & { readonly declaration: McpServerDeclaration; readonly connector?: string },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerAddRefusal | OpenRefusal>>;
    remove(
      input: McpServerScopeInput & { readonly name: string },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerRemoveRefusal | OpenRefusal>>;
    setEnabled(
      input: McpServerSeenInput & { readonly name: string; readonly enabled: boolean },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpServerChangeRefusal | OpenRefusal>>;
    signIn(
      input: McpServerSeenInput & { readonly name: string; readonly client?: McpOwnClient; readonly redirect: string },
    ): Effect.Effect<{ readonly url: string; readonly skipped?: string }, StoreFailure | GateRefusal<McpSignInRefusal>>;
    signOut(
      input: McpServerSeenInput & { readonly name: string },
    ): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpSignOutRefusal>>;
    finishSignIn(answer: McpSignInAnswer): Effect.Effect<McpSignedIn, McpSignInRejected>;
    reconcile(projectId: number): Effect.Effect<void, StoreFailure | GateRefusal<McpReconcileRefusal>>;
    reconcileAll(): Effect.Effect<void, StoreFailure | GateRefusal<McpReconcileRefusal>>;
    raise(projectId: number, name: string): Effect.Effect<readonly McpServerRow[], StoreFailure | GateRefusal<McpReconcileRefusal>>;
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
  readonly scope: McpServerScope;
  readonly shadows?: McpServerScope;
  readonly connector?: string;
  readonly contributor?: string;
  readonly redact?: readonly string[];
};
