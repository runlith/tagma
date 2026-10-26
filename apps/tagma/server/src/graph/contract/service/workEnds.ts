import { Context, type Effect } from 'effect';

export type WorkEnded = {
  readonly threadId: string;
  readonly projectId: number;
  readonly block: string;
  readonly title: string;
  readonly word: string;
  readonly commit: string | null;
};

export class WorkEnds extends Context.Service<
  WorkEnds,
  {
    publish(event: WorkEnded): Effect.Effect<void>;
    subscribe(subscriber: (event: WorkEnded) => Effect.Effect<void>): () => void;
  }
>()('tagma/graph/WorkEnds') {}
