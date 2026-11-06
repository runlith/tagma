import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';

export const ThreadsListing = Schema.Struct({
  listed: Schema.optional(Schema.Boolean).annotate({
    description:
      'True lists the threads whose bindings name this plugin in the general thread list as well as in its own places; false, the default, keeps them out of the general list while the plugin runs in their project.',
  }),
});
export type ThreadsListing = typeof ThreadsListing.Type;

export const LISTING_FACE: PluginFace<ThreadsListing> = {
  name: 'threads',
  title: 'Where its threads are listed',
  schema: ThreadsListing,
};
