import * as Schema from 'effect/Schema';

export const GraphKindChanges = Schema.Struct({
  tag: Schema.NonEmptyString,
  added: Schema.Int,
  changed: Schema.Int,
  removed: Schema.Int,
  done: Schema.Int,
  closed: Schema.Int,
  doneWord: Schema.NullOr(Schema.NonEmptyString),
  closedWord: Schema.NullOr(Schema.NonEmptyString),
});
export type GraphKindChanges = typeof GraphKindChanges.Type;

export const GraphChanges = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('counted'),
    kinds: Schema.Array(GraphKindChanges),
    files: Schema.Int,
    unsorted: Schema.Int,
    unreadable: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  }),
  Schema.Struct({ status: Schema.Literal('unread'), reason: Schema.String }),
]);
export type GraphChanges = typeof GraphChanges.Type;
