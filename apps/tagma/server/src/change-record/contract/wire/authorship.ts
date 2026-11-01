import * as Schema from 'effect/Schema';
import { NamedHolder } from '../../../workspace/contract/wire/checkout.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';

export const AuthoredSpan = Schema.Struct({ start: Schema.Int, end: Schema.Int });

export const AuthoredLine = Schema.Struct({
  kind: Schema.Literals(['context', 'added', 'removed']),
  text: Schema.String,
  before: Schema.NullOr(Schema.Int),
  after: Schema.NullOr(Schema.Int),
  author: Schema.NullOr(NamedHolder),
  spans: Schema.Array(AuthoredSpan),
  hiddenBefore: Schema.Int,
  hiddenAt: Schema.Int,
});
export type AuthoredLine = typeof AuthoredLine.Type;

export const SubmoduleEnd = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('commit'), oid: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('file') }),
  Schema.Struct({ kind: Schema.Literal('absent') }),
]);
export type SubmoduleEnd = typeof SubmoduleEnd.Type;

export const SubmoduleDiff = Schema.Struct({
  before: SubmoduleEnd,
  after: SubmoduleEnd,
  working: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(['ready', 'uninitialized', 'missing']),
      trackedChanges: Schema.Boolean,
      untrackedChanges: Schema.Boolean,
    }),
  ),
});
export type SubmoduleDiff = typeof SubmoduleDiff.Type;

export const PathAuthorship = Schema.Struct({
  rootId: RootId,
  path: Schema.NonEmptyString,
  lines: Schema.Array(AuthoredLine),
  binary: Schema.Boolean,
  timedOut: Schema.Boolean,
  submodule: Schema.optional(SubmoduleDiff),
  sides: Schema.Struct({ before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String) }),
});
export type PathAuthorship = typeof PathAuthorship.Type;

export const AuthorshipSide = Schema.Literals(['staged', 'unstaged']);
export type AuthorshipSide = typeof AuthorshipSide.Type;
