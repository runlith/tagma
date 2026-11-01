import { Schema } from 'effect';

export type RightKey = string;

const ACCESS_LEVELS = ['none', 'read', 'full'] as const;

const LAST_INSTANT_MS = 8_640_000_000_000_000;

export const rightSchema = Schema.Struct({
  key: Schema.String.annotate({ description: 'The right a declaration names.' }),
  state: Schema.String.annotate({ description: "The access filler's own word for where this right stands." }),
  access: Schema.Literals(ACCESS_LEVELS).annotate({
    description: '`none` refuses every use, `read` admits only reads, `full` admits every use.',
  }),
  unblock: Schema.Array(Schema.String).annotate({ description: 'Ways to gain the right, as the filler words them.' }),
  until: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: LAST_INSTANT_MS }))).annotate({
    description: 'Epoch milliseconds until which this answer holds.',
  }),
});
export type Right = typeof rightSchema.Type;
