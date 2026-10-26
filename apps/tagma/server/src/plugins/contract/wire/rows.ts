import { Schema } from 'effect';

export const PLUGIN_STATES = ['stopped', 'starting', 'running', 'failed'] as const;
export type PluginState = (typeof PLUGIN_STATES)[number];

export const PLUGIN_FLOORS = ['project', 'user'] as const;
export type PluginFloor = (typeof PLUGIN_FLOORS)[number];

export const pluginRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  root: Schema.String,
  floor: Schema.NullOr(Schema.Literals(PLUGIN_FLOORS)).annotate({
    description:
      'Where this project finds it: its own .plugins directory or the operator’s; null for an installed source found in neither.',
  }),
  installed: Schema.NullOr(Schema.Struct({ source: Schema.String, enabled: Schema.Boolean })),
  enabled: Schema.Boolean.annotate({ description: 'Whether this project sees its tools and views.' }),
  state: Schema.Literals(PLUGIN_STATES),
  tools: Schema.Finite.annotate({ description: 'Tools its process serves.' }),
  restarts: Schema.Finite,
  failure: Schema.optional(Schema.String).annotate({ description: 'Why it is failed, with the tail of what its process wrote.' }),
  refused: Schema.optional(Schema.String).annotate({
    description: 'Why its directory as it stands now is refused; a running process keeps the declaration it started with.',
  }),
});
export type PluginRow = typeof pluginRowSchema.Type;
