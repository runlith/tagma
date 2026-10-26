import type { McpFailure, McpNotConnected, McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { McpResourceResult, McpResourceUpdated } from '@runlith/mcp/resources';
import { Context, type Effect, type Scope, type Stream } from 'effect';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { SettingLandRefusal } from '../../../settings/contract/service/values.js';
import type { PluginRow } from '../wire/rows.js';

export class PluginPlace extends Context.Service<
  PluginPlace,
  {
    readonly home: string | null;
    readonly server: string | null;
  }
>()('tagma/plugins/PluginPlace') {}

export type PluginListRefusal = 'not-found' | 'plugin-floor-unreadable';

export type PluginInstallRefusal =
  | PluginListRefusal
  | 'plugin-unknown'
  | 'plugin-collision'
  | 'plugin-source-taken'
  | 'plugin-refused'
  | SettingLandRefusal
  | 'setting-scope'
  | 'setting-value';

export type PluginChangeRefusal = PluginListRefusal | 'plugin-not-installed' | SettingLandRefusal | 'setting-scope' | 'setting-value';

export type PluginTarget = { readonly projectId: number; readonly id: string };

export type PluginSwitch = PluginTarget & { readonly enabled: boolean };

export class Plugins extends Context.Service<
  Plugins,
  {
    start(): Effect.Effect<void, StoreFailure>;
    list(projectId: number): Effect.Effect<readonly PluginRow[], StoreFailure | GateRefusal<PluginListRefusal>>;
    install(input: PluginSwitch): Effect.Effect<PluginRow, StoreFailure | GateRefusal<PluginInstallRefusal>>;
    uninstall(input: PluginTarget): Effect.Effect<PluginRow, StoreFailure | GateRefusal<PluginChangeRefusal>>;
    enable(input: PluginSwitch): Effect.Effect<PluginRow, StoreFailure | GateRefusal<PluginChangeRefusal>>;
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
>()('tagma/plugins/Plugins') {}
