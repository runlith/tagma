import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Context, Data, type Effect, type Schema } from 'effect';

export type TagmaAppRef = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string | null;
};

export type TagmaAppContribution<A> = {
  readonly app: TagmaAppRef;
  readonly value: A;
  readonly sibling: <B>(name: string, schema: Schema.Codec<B, unknown>) => B | undefined;
  readonly tools: readonly McpToolDescriptor[] | null;
  readonly caller: McpToolCaller;
};

export class TagmaAppPointRefused extends Data.TaggedError('TagmaAppPointRefused')<{
  readonly point: string;
  readonly reason: string;
}> {
  override get message(): string {
    return `${this.point}: ${this.reason}`;
  }
}

export type TagmaAppPoint<A> = {
  readonly name: string;
  readonly owner: string;
  readonly schema: Schema.Codec<A, unknown>;
  readonly claims?: (value: A) => readonly string[];
  readonly register: (contribution: TagmaAppContribution<A>) => Effect.Effect<() => void, TagmaAppPointRefused>;
};

export class TagmaAppPoints extends Context.Service<
  TagmaAppPoints,
  {
    declare<A>(point: TagmaAppPoint<A>): Effect.Effect<() => void>;
    schema(): unknown;
  }
>()('tagma/tagma-apps/TagmaAppPoints') {}
