import { Context, Data, type Effect } from 'effect';

export class ServingUnread extends Data.TaggedError('ServingUnread')<{ readonly message: string }> {}

export class ServedRoots extends Context.Service<
  ServedRoots,
  {
    root(projectId: number, origin: string): Effect.Effect<string | null, ServingUnread>;
  }
>()('browser/ServedRoots') {}
