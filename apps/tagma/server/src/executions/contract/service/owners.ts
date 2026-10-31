import { Context, Data, type Effect } from 'effect';

export type OwnerFacts = { readonly title?: string; readonly archived: boolean };

export class OwnerFactsUnread extends Data.TaggedError('OwnerFactsUnread')<{ readonly reason: string }> {}

export class LoadOwnerFacts extends Context.Service<
  LoadOwnerFacts,
  {
    readonly read: (threads: readonly string[]) => Effect.Effect<ReadonlyMap<string, OwnerFacts>, OwnerFactsUnread>;
  }
>()('tagma/executions/LoadOwnerFacts') {}

export class LoadAppTitles extends Context.Service<
  LoadAppTitles,
  {
    readonly read: (projectId: number) => Effect.Effect<ReadonlyMap<string, string>, OwnerFactsUnread>;
  }
>()('tagma/executions/LoadAppTitles') {}
