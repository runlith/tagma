import { Context, Data, type Effect } from 'effect';

export type OwnerFacts = { readonly title?: string; readonly archived: boolean };

export class OwnerFactsUnread extends Data.TaggedError('OwnerFactsUnread')<{ readonly reason: string }> {}

export class LoadOwnerFacts extends Context.Service<
  LoadOwnerFacts,
  {
    readonly read: (threads: readonly string[]) => Effect.Effect<ReadonlyMap<string, OwnerFacts>, OwnerFactsUnread>;
  }
>()('tagma/executions/LoadOwnerFacts') {}

type OriginOwner = { readonly _tag: 'App'; readonly name: string } | { readonly _tag: 'McpView' };

export class LoadOrigins extends Context.Service<
  LoadOrigins,
  {
    readonly owner: (origin: string) => OriginOwner | undefined;
  }
>()('tagma/executions/LoadOrigins') {}
