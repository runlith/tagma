import type { McpFailure, McpNotConnected, McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { McpResourceResult, McpResourceUpdated } from '@runlith/mcp/resources';
import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { TagmaAppRow } from '../wire/rows.js';

export class TagmaAppPlace extends Context.Service<
  TagmaAppPlace,
  {
    readonly home: string | null;
    readonly server: string | null;
  }
>()('tagma/tagma-apps/TagmaAppPlace') {}

export type TagmaAppListRefusal = 'not-found' | 'app-floor-unreadable';

export type TagmaAppInstallRefusal =
  | TagmaAppListRefusal
  | 'app-unknown'
  | 'app-collision'
  | 'app-source-taken'
  | 'app-refused'
  | SettingLandRefusal
  | 'setting-scope'
  | 'setting-value';

export type TagmaAppChangeRefusal = TagmaAppListRefusal | 'app-not-installed' | SettingLandRefusal | 'setting-scope' | 'setting-value';

export type UninstallRefusal = TagmaAppChangeRefusal | 'secret-store-failed';

export type TagmaAppTarget = { readonly projectId: number; readonly id: string };

export type TagmaAppSwitch = TagmaAppTarget & { readonly enabled: boolean };

export class TagmaApps extends Context.Service<
  TagmaApps,
  {
    start(): Effect.Effect<void, StoreFailure>;
    list(projectId: number): Effect.Effect<readonly TagmaAppRow[], StoreFailure | GateRefusal<TagmaAppListRefusal>>;
    install(input: TagmaAppSwitch): Effect.Effect<TagmaAppRow, StoreFailure | GateRefusal<TagmaAppInstallRefusal>>;
    uninstall(input: TagmaAppTarget): Effect.Effect<TagmaAppRow, StoreFailure | GateRefusal<UninstallRefusal>>;
    enable(input: TagmaAppSwitch): Effect.Effect<TagmaAppRow, StoreFailure | GateRefusal<TagmaAppChangeRefusal>>;
    pending(id: string): Effect.Effect<boolean, StoreFailure>;
    call: McpToolCaller['call'];
    callAdmitted<E>(
      id: string,
      admit: Effect.Effect<void, E>,
      tool: string,
      args: Readonly<Record<string, unknown>>,
      options: McpCallOptions,
    ): Effect.Effect<Effect.Success<ReturnType<McpToolCaller['call']>>, E | McpFailure>;
    read(id: string, uri: string, options: McpCallOptions): Effect.Effect<McpResourceResult, McpResourceFailed | McpNotConnected>;
    subscribe(
      id: string,
      uri: string,
      options: McpCallOptions,
    ): Effect.Effect<Stream.Stream<McpResourceUpdated>, McpResourceFailed | McpNotConnected, Scope.Scope>;
  }
>()('tagma/tagma-apps/TagmaApps') {}
