import { Schema } from 'effect';
import type { LineEdit } from '@runlith/files/lines';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';

export const LineEditFrame: Schema.Codec<LineEdit> = Schema.Struct({
  from: Schema.Int,
  to: Schema.Int,
  lines: Schema.Array(Schema.String),
});

export const DocumentFrame = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('whole'),
    digest: Schema.NonEmptyString,
    text: Schema.String,
    readOnly: Schema.NullOr(Schema.Literal('undecodable')),
    size: Schema.Int,
    write: Schema.optional(Schema.NonEmptyString),
  }),
  Schema.Struct({
    kind: Schema.Literal('change'),
    digest: Schema.NonEmptyString,
    edits: Schema.Array(LineEditFrame),
    write: Schema.optional(Schema.NonEmptyString),
  }),
  Schema.Struct({ kind: Schema.Literal('binary'), size: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('tooLarge'), size: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal('gone') }),
  Schema.Struct({ kind: Schema.Literal('moved'), path: Schema.NonEmptyString }),
  Schema.Struct({ kind: Schema.Literal('unreadable'), reason: Schema.String }),
]);
export type DocumentFrame = typeof DocumentFrame.Type;

export const DOCUMENT_FEED = feed('document.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    root: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    path: Schema.NonEmptyString,
  }),
  event: DocumentFrame,
  refusals: [...PLACE_REFUSALS, 'path-outside-tree', 'graph-path', 'files'],
  callers: 'operator',
  admission: 'project',
});

export const LOOSE_REFUSALS = ['path-relative', 'in-checkout', 'files'] as const;

export const LOOSE_DOCUMENT_FEED = feed('file.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    path: Schema.NonEmptyString.annotate({ description: "Absolute path of a file outside every project's checkouts." }),
  }),
  event: DocumentFrame,
  refusals: [...PLACE_REFUSALS, ...LOOSE_REFUSALS],
  callers: 'operator',
  admission: 'project',
});
