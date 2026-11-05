import { Schema } from 'effect';

const name = Schema.String.check(Schema.isMinLength(1));

export const pinnedViewSchema = Schema.Struct({ plugin: name, view: name, key: name });
export type PinnedView = typeof pinnedViewSchema.Type;

export const pinContributionsSchema = Schema.Array(
  Schema.Struct({
    view: name.annotate({ description: 'A view of the plugin, one of contributes.views, that a thread may pin above its feed.' }),
  }),
);
export type PinContributions = typeof pinContributionsSchema.Type;
