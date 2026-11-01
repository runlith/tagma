import type { McpToolDescriptor } from '@runlith/mcp/McpSession';
import type { McpToolCaller } from '@runlith/mcp/mcpToolCatalog';
import { Context, Data, type Effect } from 'effect';
import type { AppFaced } from '../../../platform/contract/service/contribution.js';

export type TagmaAppRef = {
  readonly id: string;
  readonly title: string;
  readonly root: string;
  readonly data: string | null;
};

export type TagmaAppContribution<W> = {
  readonly app: TagmaAppRef;
  readonly value: W;
  readonly sibling: <B>(point: AppFaced<B>) => B | undefined;
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

export type TagmaAppRegister<W> = (contribution: TagmaAppContribution<W>) => Effect.Effect<() => void, TagmaAppPointRefused>;

export class TagmaAppPoints extends Context.Service<
  TagmaAppPoints,
  {
    declare<W>(point: AppFaced<W>, register: TagmaAppRegister<W>): Effect.Effect<() => void>;
    schema(): unknown;
  }
>()('tagma/tagma-apps/TagmaAppPoints') {}
