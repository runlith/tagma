import { Schema } from 'effect';
import { PageCursor, family } from '@runlith/paging';
import { limitOf } from '../../../../platform/contract/wire/pageFamily.js';
import { placedCursor, placeRole } from '../../../../platform/contract/wire/place.js';
import { operation } from '../../../../platform/contract/wire/operation.js';
import { graphArms as arms } from '../answers.js';
import { blockRef, tagsField } from '../fields.js';
import { journalPageSchema, journalVocabularySchema } from '../journal.js';
import { blockDiffSchema, blockMarkSchema } from '../reads.js';
import { blockSchema } from '../rows.js';
import { SURFACE_ACT, SURFACE_READ, graphInput } from './shared.js';
import { graphRecoverySchema } from '../recovery.js';
import { THREAD_WORK_CEILING, threadWorkSchema } from '../threadWork.js';
import { ThreadId } from '../../../../platform/contract/wire/thread.js';

export const fileActSchema = Schema.Struct({
  sha: Schema.String,
  author: Schema.String,
  date: Schema.String,
  message: Schema.String,
});

export const writerSessionSchema = Schema.Struct({
  id: Schema.Number,
  harness: Schema.String,
  key: Schema.String,
  thread: Schema.NullOr(Schema.String).annotate({
    description: 'The full Tagma thread id, usable as its address; null for an external writer.',
  }),
  createdAt: Schema.String,
});
export type WriterSession = typeof writerSessionSchema.Type;

export const WRITERS = family('writers', 1, 'json', { text: 81, json: 214 }, 20, () => ({
  id: 2742,
  harness: 'tagma',
  key: '01990000-0000-7000-8000-000000002742',
  thread: '01990000-0000-7000-8000-000000002742',
  createdAt: '2026-10-22T20:00:00.000Z',
}));

const read = (summary: string, done: string) => ({
  confirmation: () => ({ summary }),
  confirmLabel: 'Read',
  presentation: { running: done, done },
  subjects: () => [],
});

export const HISTORY_OPERATIONS = {
  read_block_diff: operation('read_block_diff', {
    ...SURFACE_READ,
    ...read('Read how this block changed?', 'Read a block diff'),
    meaning: 'Read how one block and its subtree changed between two journal positions, or since a time the reader saw it.',
    input: graphInput({
      blockId: blockRef,
      since: Schema.optional(Schema.String),
      from: Schema.optional(Schema.Number),
      to: Schema.optional(Schema.Number),
    }),
    answer: arms({
      ok: { diff: blockDiffSchema, marks: Schema.Array(blockMarkSchema), blocks: Schema.Array(blockSchema) },
    }),
    refusals: ['not-found', 'bad-since', 'journal-unreadable'],
  }),

  read_journal: operation('read_journal', {
    ...SURFACE_READ,
    ...read('Read the journal?', 'Read the journal'),
    meaning: 'Read the journal of the served project as batches of one writer’s consecutive acts on one block, newest first.',
    input: graphInput({
      tags: Schema.optional(tagsField),
      sessions: Schema.optional(Schema.Array(Schema.Number)),
      ops: Schema.optional(Schema.Array(Schema.String)),
      before: Schema.optional(Schema.Number),
      since: Schema.optional(Schema.Number),
      limit: Schema.optional(Schema.Number),
    }),
    answer: arms({ ok: journalPageSchema.fields }),
    refusals: [],
  }),

  read_journal_vocabulary: operation('read_journal_vocabulary', {
    ...SURFACE_READ,
    ...read('Read what the journal can be filtered by?', 'Read the journal vocabulary'),
    meaning: 'Read the writers, acts and tags the journal of the served project can be filtered by.',
    input: graphInput({}),
    answer: arms({ ok: journalVocabularySchema.fields }),
    refusals: [],
  }),

  read_block_log: operation('read_block_log', {
    ...SURFACE_READ,
    ...read('Read the commits behind this block’s file?', 'Read a block file log'),
    meaning: 'Read the commits of the block tree that touched one block’s file, following renames.',
    input: graphInput({ blockId: blockRef }),
    answer: arms({ ok: { log: Schema.Array(fileActSchema) } }),
    refusals: ['graph-required', 'not-projected', 'files'],
  }),

  read_graph_recovery: operation('read_graph_recovery', {
    ...SURFACE_READ,
    ...read('Read the pending graph recovery?', 'Read graph recovery'),
    meaning:
      'Read the pending graph merge, its isolated recovery directory, both commits and the assigned thread. This reading does not require a readable graph mirror.',
    input: graphInput({ branch: Schema.optional(Schema.String) }),
    answer: arms({ ok: { recovery: Schema.NullOr(graphRecoverySchema) } }),
    refusals: ['team-tree'],
  }),

  resolve_graph_conflict: operation('resolve_graph_conflict', {
    ...SURFACE_ACT,
    meaning:
      'Resolve the graph files of an open merge. In team storage, validate the edited graph files and stage only their conflicts in the project checkout; commit is null and the repository merge stays open for its commit owner. In stealth storage, publish the validated isolated recovery preserving newer target work; read_graph_recovery names its directory.',
    input: graphInput({ branch: Schema.optional(Schema.String) }),
    answer: arms({
      ok: {
        commit: Schema.NullOr(Schema.String),
        resolved: Schema.Array(Schema.String),
        remaining: Schema.optional(Schema.Array(Schema.String)),
      },
    }),
    refusals: ['graph-required', 'team-tree', 'no-merge', 'files'],
    confirmation: () => ({ summary: 'Conclude the open merge of the block tree?' }),
    confirmLabel: 'Resolve',
    presentation: { running: 'Concluding the tree merge', done: 'Concluded the tree merge' },
    subjects: () => [],
  }),

  read_session: operation('read_session', {
    ...SURFACE_READ,
    ...read('Read this writer session?', 'Read a writer'),
    meaning:
      'Resolve a numeric writer-session id, including a block holder, in the served graph copy to its writer and full thread address. Keep the project and checkout of the block reading: numeric ids belong to that copy. External writers have no Tagma thread.',
    input: graphInput({
      id: Schema.Int.check(Schema.isGreaterThan(0)),
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'The registered checkout of the graph copy that supplied this writer id; omitted, the calling checkout.',
      }),
    }),
    answer: arms({ ok: { session: writerSessionSchema } }),
    refusals: ['not-found'],
  }),

  read_thread_work: operation('read_thread_work', {
    ...SURFACE_READ,
    tool: undefined,
    ...read('Read what this thread works on in the graph and what it did there?', 'Read a thread’s graph work'),
    meaning:
      'Read the work a thread holds, each with the spec above it, and a page of the blocks it created, edited, finished or closed, newest first, with the commit that ended each piece of work, across every graph copy the thread works in. Hand back `next` as the cursor for the following page.',
    input: Schema.Struct({
      threadId: ThreadId,
      limit: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(THREAD_WORK_CEILING))),
      cursor: Schema.optional(Schema.String.annotate(placeRole('value'))),
    }),
    answer: arms({ ok: threadWorkSchema.fields }),
    refusals: ['not-found', 'bad-cursor', 'cursor-stale', 'copies-unreadable'],
  }),

  list_sessions: operation('list_sessions', {
    ...SURFACE_READ,
    ...read('List the writers of this project?', 'Listed the writers'),
    meaning:
      'Read a page of the writer sessions that have written into the served project, newest id first. Each Tagma writer carries its full thread address; use read_session(id) for one holder. Hand back the cursor alone to continue in the same project.',
    input: graphInput({
      checkout: Schema.optional(Schema.NonEmptyString.annotate(placeRole('checkout'))).annotate({
        description: 'The registered checkout whose graph writers are read.',
      }),
      limit: limitOf(WRITERS),
      cursor: placedCursor,
    }),
    answer: arms({
      ok: { sessions: Schema.Array(writerSessionSchema), shown: Schema.Number, total: Schema.Number, next: Schema.NullOr(PageCursor) },
    }),
    refusals: ['bad-cursor', 'cursor-stale'],
  }),
};
