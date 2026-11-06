import type { McpConnectFailed, McpNotConnected, McpResourceFailed } from '@runlith/mcp/McpFailure';
import type { McpCallOptions } from '@runlith/mcp/McpSession';
import type { McpResourceResult, McpResourceUpdated } from '@runlith/mcp/resources';
import { Context, Duration, type Effect, type Scope, type Stream } from 'effect';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import type { PluginCaller } from '../../../plugins/contract/service/points.js';
import type { PluginProcessRow } from '../../../plugins/contract/wire/rows.js';

export const PLUGIN_QUIET = Duration.minutes(5);

export class HostPlace extends Context.Service<HostPlace, { readonly server: string | null; readonly quiet: Duration.Input }>()(
  'tagma/plugin-host/HostPlace',
) {}

export class PluginHost extends Context.Service<
  PluginHost,
  {
    start(): Effect.Effect<void>;
    readonly started: Effect.Effect<void>;
    reading(id: string): PluginProcessRow | undefined;
    hosts(id: string): boolean;
    title(id: string): string | null;
    pending(id: string): Effect.Effect<boolean, PluginsUnreadable>;
    call: PluginCaller['call'];
    callAdmitted: PluginCaller['callAdmitted'];
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
