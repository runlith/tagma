import { Schema } from 'effect';
import { feed } from '../../../platform/contract/wire/operation.js';
import { PLACE_REFUSALS } from '../../../workspace/contract/wire/refusals.js';

export const SEARCH_MATCHES = 20_000;

export const SearchRange = Schema.Struct({ start: Schema.Int, end: Schema.Int });

export const SearchMatch = Schema.Struct({
  line: Schema.Int,
  preview: Schema.String,
  ranges: Schema.Array(SearchRange),
});
export type SearchMatch = typeof SearchMatch.Type;

export const SearchFrame = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('file'), file: Schema.NonEmptyString, matches: Schema.Array(SearchMatch) }),
  Schema.Struct({
    kind: Schema.Literal('done'),
    files: Schema.Int,
    matches: Schema.Int,
    truncated: Schema.Boolean,
    elapsed: Schema.Int,
  }),
]);
export type SearchFrame = typeof SearchFrame.Type;

export const SEARCH_FEED = feed('search.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    root: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
    pattern: Schema.String.check(Schema.isMinLength(1)),
    regex: Schema.Boolean,
    caseSensitive: Schema.Boolean,
    wholeWord: Schema.Boolean,
    include: Schema.optional(Schema.Array(Schema.NonEmptyString)),
    exclude: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  }),
  event: SearchFrame,
  refusals: [...PLACE_REFUSALS, 'search-failed', 'search-unavailable', 'search-superseded'],
  callers: 'operator',
  admission: 'project',
});
