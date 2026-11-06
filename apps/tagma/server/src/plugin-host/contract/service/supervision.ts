import type { McpConnectFailed, McpFailure, McpNotConnected, McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import type { McpResourceResult, McpResourceUpdated } from '@runlith/mcp/resources';
import { Context, Duration, type Effect, type Scope, type Stream } from 'effect';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import type { PluginProcessRow } from '../../../plugins/contract/wire/rows.js';

export const PLUGIN_QUIET = Duration.minutes(5);

export class HostPlace extends Context.Service<HostPlace, { readonly server: string | null; readonly quiet: Duration.Input }>()(
  'tagma/plugin-host/HostPlace',
) {}

export class PluginHost extends Context.Service<
  PluginHost,
  {
    start(): Effect.Effect<void>;
    reading(id: string): PluginProcessRow | undefined;
    hosts(id: string): boolean;
    title(id: string): string | null;
    pending(id: string): Effect.Effect<boolean, PluginsUnreadable>;
    call: McpToolCaller['call'];
    callAdmitted<E>(
      id: string,
      admit: Effect.Effect<void, E>,
      tool: string,
      args: Readonly<Record<string, unknown>>,
      options: McpCallOptions,
    ): Effect.Effect<Effect.Success<ReturnType<McpToolCaller['call']>>, E | McpFailure>;
    read(
      id: string,
      uri: string,
      options: McpCallOptions,
    ): Effect.Effect<McpResourceResult, McpResourceFailed | McpNotConnected | McpConnectFailed>;
    subscribe(
      id: string,
      uri: string,
      options: McpCallOptions,
    ): Effect.Effect<Stream.Stream<McpResourceUpdated>, McpResourceFailed | McpNotConnected | McpConnectFailed, Scope.Scope>;
  }
>()('tagma/plugin-host/PluginHost') {}
