import { Schema } from 'effect';
import { BLOCKS, EVENTS, GAUGES, TASKS } from './operations/shared.js';
import { WRITERS } from './operations/history.js';
import { blockQuerySchema } from './query.js';
import { typeSelectorSchema } from './tags/selector.js';

export const WRITERS_WALK = {
  operation: 'list_sessions',
  order: WRITERS.order,
  selection: Schema.Struct({ projectId: Schema.Number, checkout: Schema.NullOr(Schema.String) }),
  key: Schema.Tuple([Schema.Int.check(Schema.isGreaterThan(0))]),
};

const checkout = Schema.NullOr(Schema.String);

const stamped = Schema.Tuple([Schema.Number, Schema.Number]);

export const READY_WALK = {
  operation: 'ready_work',
  order: TASKS.order,
  selection: Schema.Struct({ projectId: Schema.optional(Schema.Number), checkout, scopeId: Schema.optional(Schema.String) }),
  key: stamped,
};

export const QUERY_WALK = {
  operation: 'query_blocks',
  order: BLOCKS.order,
  selection: Schema.Struct({ ...blockQuerySchema.fields, projectId: Schema.Number, checkout }),
  key: Schema.Tuple([Schema.NullOr(Schema.Number), Schema.Number]),
};

export const SEARCH_WALK = {
  operation: 'search_blocks',
  order: BLOCKS.order,
  selection: Schema.Struct({
    query: Schema.String,
    tag: Schema.optional(Schema.String),
    selector: Schema.optional(typeSelectorSchema),
    status: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    history: Schema.optional(Schema.Boolean),
    scopeId: Schema.optional(Schema.Number),
    projectId: Schema.optional(Schema.Number),
    checkout,
    spelled: Schema.optional(Schema.Array(Schema.Array(Schema.String))),
  }),
  key: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number]),
};

export const EVENTS_WALK = {
  operation: 'read_events',
  order: EVENTS.order,
  selection: Schema.Struct({
    projectId: Schema.Number,
    checkout,
    blockId: Schema.optional(Schema.String),
    sinceId: Schema.optional(Schema.Number),
  }),
  key: Schema.Tuple([Schema.Int.check(Schema.isGreaterThan(0))]),
};

export const GAUGES_WALK = {
  operation: 'read_gauges',
  order: GAUGES.order,
  selection: Schema.Struct({ projectId: Schema.Number, checkout, path: Schema.String }),
  key: Schema.Tuple([Schema.String, Schema.Number, Schema.Number]),
};
