import { Schema } from 'effect';

export const TAGMA_APP_STATES = ['stopped', 'starting', 'running', 'failed'] as const;
export type TagmaAppState = (typeof TAGMA_APP_STATES)[number];

export const TAGMA_APP_FLOORS = ['project', 'user'] as const;
export type TagmaAppFloor = (typeof TAGMA_APP_FLOORS)[number];

export const tagmaAppRowSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  root: Schema.String,
  floor: Schema.NullOr(Schema.Literals(TAGMA_APP_FLOORS)).annotate({
    description:
      'Where this project finds it: its own .tagma-apps directory or the operator’s; null for an installed source found in neither.',
  }),
  installed: Schema.NullOr(Schema.Struct({ source: Schema.String, enabled: Schema.Boolean })),
  enabled: Schema.Boolean.annotate({ description: 'Whether this project sees its tools and views.' }),
  state: Schema.Literals(TAGMA_APP_STATES),
  tools: Schema.Finite.annotate({ description: 'Tools its process serves.' }),
  restarts: Schema.Finite,
  failure: Schema.optional(Schema.String).annotate({ description: 'Why it is failed, with the tail of what its process wrote.' }),
  refused: Schema.optional(Schema.String).annotate({
    description: 'Why its directory as it stands now is refused; a running process keeps the declaration it started with.',
  }),
});
export type TagmaAppRow = typeof tagmaAppRowSchema.Type;
