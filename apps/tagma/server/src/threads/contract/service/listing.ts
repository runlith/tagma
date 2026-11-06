import { Context } from 'effect';

export type PluginListing = {
  listed(): ReadonlySet<string>;
  changed(subscriber: () => void): () => void;
};

export const ThreadListing = Context.Reference<PluginListing>('threads/ThreadListing', {
  defaultValue: () => ({ listed: () => new Set<string>(), changed: () => () => undefined }),
});
