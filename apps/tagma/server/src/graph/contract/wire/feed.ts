import { Schema } from 'effect';
import { OPEN_REFUSALS } from '../../../platform/contract/wire/refusal.js';
import { feed } from '../../../platform/contract/wire/operation.js';
import { GRAPH_EVENT_OPS, eventSchema, journalSessionSchema } from './journal.js';
import { recoveryNoticeSchema } from './recovery.js';
import { graphRemoteSchema } from './remote.js';
import { edgeSchema, refSchema, treeBlockSchema } from './rows.js';

const changeEventSchema = Schema.Struct({ ...eventSchema.fields, op: Schema.Literals(GRAPH_EVENT_OPS) });

export const graphChangeSchema = Schema.Struct({
  type: Schema.tag('change'),
  projectId: Schema.Number,
  events: Schema.Array(changeEventSchema),
  unreadable: Schema.optional(Schema.Array(Schema.Number)),
  blocks: Schema.Array(treeBlockSchema),
  edges: Schema.Array(edgeSchema),
  refs: Schema.Array(refSchema),
  sessions: Schema.Array(journalSessionSchema),
  ready: Schema.Array(Schema.String),
  trash: Schema.Array(treeBlockSchema),
});

export const graphResyncSchema = Schema.Struct({ type: Schema.tag('resync') });

export const graphFrameSchema = Schema.Union([graphResyncSchema, graphChangeSchema]).pipe(Schema.toTaggedUnion('type'));

export const threadWorkChangeSchema = Schema.Struct({
  type: Schema.tag('change'),
  own: Schema.Boolean.annotate({ description: 'The thread itself wrote this change.' }),
  names: Schema.Array(Schema.String).annotate({ description: 'The blocks the change touched.' }),
});

export const threadWorkFrameSchema = Schema.Union([graphResyncSchema, threadWorkChangeSchema]).pipe(Schema.toTaggedUnion('type'));

export const GRAPH_WORK_FEED = feed('graph.work', {
  input: Schema.Struct({ projectId: Schema.Int.check(Schema.isGreaterThan(0)), threadId: Schema.String }),
  event: threadWorkFrameSchema,
  refusals: ['not-found', 'copies-unreadable', ...OPEN_REFUSALS],
  callers: 'any',
  admission: 'project',
});

export const GRAPH_RECOVERY_FEED = feed('graph.recovery', {
  input: Schema.Struct({ projectId: Schema.Int.check(Schema.isGreaterThan(0)) }),
  event: recoveryNoticeSchema,
  refusals: ['team-tree', ...OPEN_REFUSALS],
  callers: 'any',
  admission: 'project',
});

export const GRAPH_REMOTE_FEED = feed('graph.remote', {
  input: Schema.Struct({ projectId: Schema.Int.check(Schema.isGreaterThan(0)) }),
  event: graphRemoteSchema,
  refusals: ['not-found', ...OPEN_REFUSALS],
  callers: 'any',
  admission: 'project',
});

export const GRAPH_FEED = feed('graph.subscribe', {
  input: Schema.Struct({
    projectId: Schema.Int.check(Schema.isGreaterThan(0)),
    branch: Schema.optional(Schema.String),
  }),
  event: graphFrameSchema,
  refusals: ['not-found', ...OPEN_REFUSALS],
  callers: 'any',
  admission: 'project',
});
