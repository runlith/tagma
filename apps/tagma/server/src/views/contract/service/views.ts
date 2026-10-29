import type { McpAppCallResult, McpAppCsp } from '@runlith/mcp/apps';
import type { McpCaller } from '@runlith/mcp/caller';
import type { McpResourceResult } from '@runlith/mcp/resources';
import { Context, type Effect, type Stream } from 'effect';
import type { McpResourceEvent } from '../../../mcp/contract/wire/feeds.js';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { StorageRefusalCode, TagmaAppViewState, ViewRefusalCode, ViewSite } from '../wire/sets.js';

export type ViewMount = { readonly projectId: number; readonly app: string; readonly view: string };

export type ViewFailure = StoreFailure | GateRefusal<ViewRefusalCode>;

export class ViewSites extends Context.Service<
  ViewSites,
  {
    site(app: string): ViewSite;
    readonly moved: Stream.Stream<void>;
  }
>()('tagma/views/ViewSites') {}

export class TagmaAppViews extends Context.Service<
  TagmaAppViews,
  {
    sets(projectId: number, sites: ViewSites['Service']): Stream.Stream<TagmaAppViewState, StoreFailure>;
    readonly standing: Stream.Stream<ReadonlySet<string>>;
    file(app: string, path: string): Effect.Effect<string | null>;
    csp(app: string, path: string): Effect.Effect<McpAppCsp>;
    call(
      mount: ViewMount,
      tool: string,
      args: Readonly<Record<string, unknown>>,
      caller: McpCaller,
    ): Effect.Effect<McpAppCallResult, ViewFailure>;
    read(mount: ViewMount, uri: string): Effect.Effect<McpResourceResult, ViewFailure>;
    watch(mount: ViewMount, uri: string): Stream.Stream<McpResourceEvent, ViewFailure>;
  }
>()('tagma/views/TagmaAppViews') {}

export type StorageFailure = StoreFailure | GateRefusal<StorageRefusalCode>;

export class ViewStorage extends Context.Service<
  ViewStorage,
  {
    get(mount: ViewMount, key: string): Effect.Effect<{ readonly stored: boolean; readonly value?: unknown }, StorageFailure>;
    set(mount: ViewMount, key: string, value: unknown): Effect.Effect<boolean, StorageFailure>;
  }
>()('tagma/views/ViewStorage') {}
