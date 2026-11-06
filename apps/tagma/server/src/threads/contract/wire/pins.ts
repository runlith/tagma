import { Schema } from 'effect';
import type { PluginFace } from '../../../platform/contract/wire/contribution.js';
import { undeclaredViews } from '../../../views/contract/wire/points.js';

const name = Schema.String.check(Schema.isMinLength(1));

export const pinnedViewSchema = Schema.Struct({ plugin: name, view: name, key: name });
export type PinnedView = typeof pinnedViewSchema.Type;

const pinContributionsSchema = Schema.Array(
  Schema.Struct({
    view: name.annotate({ description: 'A view of the plugin, one of contributes.views, that a thread may pin above its feed.' }),
  }),
);
export type PinContributions = typeof pinContributionsSchema.Type;

export const PINS_FACE: PluginFace<PinContributions> = {
  name: 'pins',
  title: 'Pages a thread can keep above its feed',
  schema: pinContributionsSchema,
  refuses: (pins, { sibling }) =>
    undeclaredViews(
      sibling,
      pins.map((pin) => pin.view),
    ),
};
