import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Context, Data, type Effect, type Result } from 'effect';
import type { PluginFaced } from '../../../platform/contract/service/contribution.js';

export type PluginRef = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string;
};

export type PluginContribution<W> = {
  readonly plugin: PluginRef;
  readonly value: W;
  readonly sibling: <B>(point: PluginFaced<B>) => B | undefined;
  readonly tools: readonly McpToolDescriptor[] | null;
  readonly caller: McpToolCaller;
};

export class PluginPointRefused extends Data.TaggedError('PluginPointRefused')<{
  readonly point: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.point}: ${this.reason}`;
  }
}

export type PluginRegister<W> = (contribution: PluginContribution<W>) => Effect.Effect<() => void, PluginPointRefused>;

export type PluginChecked = Readonly<Record<string, unknown>>;

export class PluginPoints extends Context.Service<
  PluginPoints,
  {
    declare<W>(point: PluginFaced<W>, register: PluginRegister<W>): Effect.Effect<() => void>;
    check(plugin: string, contributes: Readonly<Record<string, unknown>>): Result.Result<PluginChecked, string>;
    publish(
      plugin: PluginRef,
      checked: PluginChecked,
      tools: readonly McpToolDescriptor[] | null,
      caller: McpToolCaller,
    ): Effect.Effect<() => void, PluginPointRefused>;
  }
>()('tagma/plugins/PluginPoints') {}
