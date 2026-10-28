import { Schema } from 'effect';
import { edgeNameSchema } from './edges.js';
import { documentRef, nameRef, place } from './fields.js';
import { typeSelectorSchema } from './tags/selector.js';

export const BLOCK_SORT_KEYS = ['updated', 'created', 'ended'] as const;

export const SELECTABLE_ROLES = ['status'] as const;
export type SelectableRole = (typeof SELECTABLE_ROLES)[number];

const queryFields = (ref: Schema.String) => ({
  selector: Schema.optional(typeSelectorSchema),
  tags: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMinLength(1))),
  fields: Schema.optional(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMinLength(1))])),
  ),
  roles: Schema.optional(
    Schema.Record(
      Schema.Literals(SELECTABLE_ROLES),
      Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMinLength(1))])),
    ),
  ),
  includeResting: Schema.optional(Schema.Literal(true)),
  scope: Schema.optional(Schema.Array(ref).check(Schema.isMinLength(1))),
  anchorPaths: Schema.optional(Schema.Array(place).check(Schema.isMinLength(1))),
  withoutAnchorPaths: Schema.optional(Schema.Array(place).check(Schema.isMinLength(1))),
  edge: Schema.optional(
    Schema.Struct({
      kind: edgeNameSchema,
      to: Schema.optional(ref),
      from: Schema.optional(ref),
      transitive: Schema.optional(Schema.Literal(true)),
    }).check(
      Schema.makeFilter((hop) =>
        (hop.to === undefined) === (hop.from === undefined) ? 'An edge names one direction: either to or from.' : undefined,
      ),
    ),
  ),
  assigneeSessionId: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  since: Schema.optional(Schema.String),
  blocked: Schema.optional(Schema.Boolean),
  superseded: Schema.optional(Schema.Boolean),
  building: Schema.optional(Schema.Boolean),
  answered: Schema.optional(Schema.Boolean),
  stealth: Schema.optional(Schema.Boolean).annotate({
    description: "true: only blocks in stealth storage, Tagma's data directory; false: only blocks the repository carries.",
  }),
  sort: Schema.Struct({
    by: Schema.Literals(BLOCK_SORT_KEYS),
    order: Schema.Literals(['asc', 'desc']),
  }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});

export const blockQuerySchema = Schema.Struct(queryFields(nameRef));
export type BlockQuery = typeof blockQuerySchema.Type;

export const documentQuerySchema = Schema.Struct(queryFields(documentRef));

export const QUERY_REF_KEYS: readonly string[] = ['scope', 'to', 'from'];

export const GROUP_FIELDS = ['status', 'tag', 'parent'] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];
export const viewLayoutSchema = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('list') }),
  Schema.Struct({ mode: Schema.Literal('sections'), by: Schema.Literals(GROUP_FIELDS) }),
  Schema.Struct({ mode: Schema.Literal('board'), by: Schema.Literals(GROUP_FIELDS) }),
]).pipe(Schema.toTaggedUnion('mode'));
export type ViewLayout = typeof viewLayoutSchema.Type;

export const VIEW_QUERY = 'query';
export const VIEW_LAYOUT = 'layout';
