import { Schema } from 'effect';
import { JournalPosition } from './answers.js';
import { BlockName } from './references.js';
import { blockSchema } from './rows.js';

export const GRAPH_EVENT_OPS = [
  'project_add',
  'project_set_root',
  'project_set',
  'project_set_storage',
  'project_remove',
  'project_return',
  'create',
  'update',
  'claim',
  'release',
  'done',
  'close',
  'link',
  'unlink',
  'anchor',
  'unanchor',
  'relocate',
  'supersede',
  'unsupersede',
  'settle',
  'delete',
  'restore',
  'enable',
  'disable',
  'enforce',
  'remeasure',
  'accept',
  'reject',
  'uphold',
  'revise',
  'answer',
  'unanswer',
] as const;
export type GraphEventOp = (typeof GRAPH_EVENT_OPS)[number];

export type JournalSelection = {
  tags?: readonly string[];
  sessions?: readonly number[];
  ops?: readonly string[];
};

export const journalSessionSchema = Schema.Struct({
  id: Schema.Number,
  harness: Schema.String,
  key: Schema.String,
  title: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
});

export const journalPageSchema = Schema.Struct({
  batches: Schema.Array(
    Schema.Struct({
      blockName: BlockName,
      sessionId: Schema.NullOr(Schema.Number),
      ops: Schema.Array(Schema.String),
      entries: Schema.Number,
      firstEventId: JournalPosition,
      lastEventId: JournalPosition,
      firstTs: Schema.String,
      lastTs: Schema.String,
    }),
  ),
  blocks: Schema.Array(blockSchema),
  sessions: Schema.Array(journalSessionSchema),
  nextBefore: Schema.NullOr(JournalPosition),
});
export type JournalPageBody = typeof journalPageSchema.Type;
export type JournalBatch = JournalPageBody['batches'][number];
export type JournalSession = JournalPageBody['sessions'][number];

export const journalVocabularySchema = Schema.Struct({
  sessions: Schema.Array(journalSessionSchema),
  ops: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
});
export type JournalVocabularyBody = typeof journalVocabularySchema.Type;

export type JournalVocabulary = typeof journalVocabularySchema.Type;

export const eventSchema = Schema.Struct({
  id: Schema.Number,
  ts: Schema.String,
  sessionId: Schema.NullOr(Schema.Number),
  op: Schema.String,
  blockName: Schema.NullOr(Schema.String),
  payload: Schema.String,
});

export type JournalEvent = typeof eventSchema.Type;
