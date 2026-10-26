import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Context, Data, type Effect, type Schema } from 'effect';

export type PluginRef = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string | null;
};

export type PluginContribution<A> = {
  readonly plugin: PluginRef;
  readonly value: A;
  readonly sibling: <B>(name: string, schema: Schema.Codec<B, unknown>) => B | undefined;
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

export type PluginPoint<A> = {
  readonly name: string;
  readonly owner: string;
  readonly schema: Schema.Codec<A, unknown>;
  readonly claims?: (value: A) => readonly string[];
  readonly register: (contribution: PluginContribution<A>) => Effect.Effect<() => void, PluginPointRefused>;
};

export class PluginPoints extends Context.Service<
  PluginPoints,
  {
    declare<A>(point: PluginPoint<A>): Effect.Effect<() => void>;
    schema(): unknown;
  }
>()('tagma/plugins/PluginPoints') {}
