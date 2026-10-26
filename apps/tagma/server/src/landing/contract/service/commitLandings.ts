import { Context, type Effect } from 'effect';

export type CommitLanded = {
  readonly threadId: string;
  readonly projectId: number;
  readonly commit: string;
  readonly subject: string;
};

export class CommitLandings extends Context.Service<
  CommitLandings,
  {
    publish(event: CommitLanded): Effect.Effect<void>;
    subscribe(subscriber: (event: CommitLanded) => Effect.Effect<void>): () => void;
  }
>()('tagma/landing/CommitLandings') {}
