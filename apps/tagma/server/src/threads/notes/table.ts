import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { project } from '../../projects/store/table.js';
import { threadRecord } from '../../thread-record/store/table.js';
import type { NoteScope } from '../contract/wire/notes.js';

export const operatorNote = sqliteTable(
  'operator_note',
  {
    scopeKind: text('scope_kind').$type<NoteScope>().notNull(),
    scopeKey: text('scope_key').notNull(),
    projectId: integer('project_id').references(() => project.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => threadRecord.id, { onDelete: 'cascade' }),
    noteId: text('note_id').notNull(),
    text: text('text'),
    switch: text('switch').$type<'on' | 'off'>(),
    writtenAt: integer('written_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scopeKind, table.scopeKey, table.noteId] }),
    index('operator_note_thread_idx').on(table.threadId),
    index('operator_note_project_idx').on(table.projectId),
  ],
);
