import { Context, type Effect } from 'effect';

export type ProjectRemoved = { readonly projectId: number };

export type GroupChange = { readonly groupId: number; readonly before: readonly number[]; readonly after: readonly number[] };

export class ProjectChanges extends Context.Service<
  ProjectChanges,
  {
    readonly removed: {
      publish(event: ProjectRemoved): Effect.Effect<void>;
      subscribe(subscriber: (event: ProjectRemoved) => Effect.Effect<void>): () => void;
    };
    readonly grouped: {
      subscribe(subscriber: (change: GroupChange) => Effect.Effect<void>): () => void;
    };
    readonly changed: {
      publish(): Effect.Effect<void>;
      subscribe(subscriber: Effect.Effect<void>): () => void;
    };
  }
>()('tagma/projects/ProjectChanges') {}
