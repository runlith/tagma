import { Context, Effect } from 'effect';

export type PluginHiding = ReadonlyMap<number, ReadonlySet<string>>;

export type PluginListing = {
  hiding(projects: readonly number[]): Effect.Effect<PluginHiding>;
  hides(projectId: number, plugin: string): boolean;
  changed(subscriber: () => void): () => void;
};

const NO_HIDING: PluginHiding = new Map();

export const ThreadListing = Context.Reference<PluginListing>('threads/ThreadListing', {
  defaultValue: () => ({ hiding: () => Effect.succeed(NO_HIDING), hides: () => false, changed: () => () => undefined }),
});
