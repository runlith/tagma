import { Context, type Effect } from 'effect';

export type ProjectRemoved = { readonly projectId: number };

export class ProjectChanges extends Context.Service<
  ProjectChanges,
  {
    readonly removed: {
      publish(event: ProjectRemoved): Effect.Effect<void>;
      subscribe(subscriber: (event: ProjectRemoved) => Effect.Effect<void>): () => void;
    };
    readonly changed: {
      publish(): Effect.Effect<void>;
      subscribe(subscriber: Effect.Effect<void>): () => void;
    };
  }
>()('tagma/projects/ProjectChanges') {}
