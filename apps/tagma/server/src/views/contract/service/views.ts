import type { McpAppCallResult } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceResult } from '@runlith/mcp/resources';
import { Context, type Effect, type Stream } from 'effect';
import type { McpResourceEvent } from '@runlith/mcp/apps';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { PluginsUnreadable } from '../../../plugins/contract/service/plugins.js';
import type { PluginViewState, StorageRefusalCode, ViewRefusalCode } from '../wire/sets.js';

export type ViewMount = { readonly projectId: number; readonly plugin: string; readonly view: string };

export type ViewFailure = StoreFailure | GateRefusal<ViewRefusalCode>;

export class PluginViews extends Context.Service<
  PluginViews,
  {
    sets(projectId: number): Stream.Stream<PluginViewState, PluginsUnreadable>;
    call(
      mount: ViewMount,
      tool: string,
      args: Readonly<Record<string, unknown>>,
      caller: McpCaller,
    ): Effect.Effect<McpAppCallResult, ViewFailure>;
    read(mount: ViewMount, uri: string): Effect.Effect<McpResourceResult, ViewFailure>;
    watch(mount: ViewMount, uri: string): Stream.Stream<McpResourceEvent, ViewFailure>;
  }
>()('tagma/views/PluginViews') {}

export type StorageFailure = StoreFailure | GateRefusal<StorageRefusalCode>;

export class ViewStorage extends Context.Service<
  ViewStorage,
  {
    get(mount: ViewMount, key: string): Effect.Effect<{ readonly stored: boolean; readonly value?: unknown }, StorageFailure>;
    set(mount: ViewMount, key: string, value: unknown): Effect.Effect<boolean, StorageFailure>;
  }
>()('tagma/views/ViewStorage') {}
