import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { CommandWindow } from '@runlith/agent-tools/WorkspaceChanges';
import { workspaceChangeContent, workspaceChangeReleased } from './tables.js';
import { uuidv7 } from 'uuidv7';
import { project } from '../../projects/store/table.js';
import { writes } from '../../platform/contract/service/writes.js';
import { type Role, WRITER } from '../record/roles.js';

export type WindowBase = Readonly<Record<string, { readonly digest: string; readonly present: boolean | null }>>;

export type WindowMove = {
  readonly name: string;
  readonly before: string | null;
  readonly after: string;
  readonly present: boolean;
  readonly existed: boolean | null;
  readonly written: CommandWindow | null;
  readonly link: boolean;
  readonly mode: number | null;
};

export const commandWindow = sqliteTable(
  'command_window',
  {
    id: text('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    runHint: text('run_hint'),
    checkout: text('checkout').notNull(),
    spelling: text('spelling').notNull(),
    head: text('head'),
    openedAt: integer('opened_at').notNull(),
    startedAt: integer('started_at'),
    endedAt: integer('ended_at'),
    windowFrom: integer('window_from'),
    windowTo: integer('window_to'),
    base: text('base', { mode: 'json' }).$type<WindowBase>(),
    moves: text('moves', { mode: 'json' }).$type<readonly WindowMove[]>(),
    role: text('role', { mode: 'json' }).$type<Role>().notNull().default(WRITER),
    signatures: text('signatures', { mode: 'json' }).$type<readonly (string | null)[]>().notNull().default([]),
    team: text('team'),
  },
  (table) => [index('command_window_project_idx').on(table.projectId), index('command_window_opened_idx').on(table.openedAt)],
);

export type SignatureRun = 'clean' | 'hit';

export const commandSignature = sqliteTable(
  'command_signature',
  {
    repository: text('repository').notNull(),
    signature: text('signature').notNull(),
    runs: text('runs', { mode: 'json' }).$type<readonly SignatureRun[]>().notNull(),
    streak: integer('streak').notNull(),
    hitAt: integer('hit_at'),
    hitPath: text('hit_path'),
  },
  (table) => [primaryKey({ columns: [table.repository, table.signature] })],
);

export const commandUnattributed = sqliteTable(
  'command_unattributed',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull(),
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    reason: text('reason').notNull(),
    team: text('team'),
    digest: text('digest'),
    at: integer('at').notNull(),
  },
  (table) => [
    index('command_unattributed_thread_idx').on(table.projectId, table.threadId, table.at),
    index('command_unattributed_place_idx').on(table.checkout, table.path),
  ],
);

export const commandUnowned = sqliteTable(
  'command_unowned',
  {
    id: text('id').primaryKey(),
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    after: text('after').notNull(),
    at: integer('at').notNull(),
  },
  (table) => [index('command_unowned_at_idx').on(table.at)],
);

export const commandContent = sqliteTable(
  'command_content',
  {
    window: text('window')
      .notNull()
      .references(() => commandWindow.id, { onDelete: 'cascade' }),
    digest: text('digest')
      .notNull()
      .references(() => workspaceChangeContent.digest),
  },
  (table) => [primaryKey({ columns: [table.window, table.digest] }), index('command_content_digest_idx').on(table.digest)],
);

export const windowWrites = writes('CommandWindows', [commandWindow, commandContent, workspaceChangeContent]);

export const unownedWrites = writes('CommandUnowned', [commandUnowned]);

export const closingWrites = writes('CommandWindowsClosed', [commandWindow, commandContent, commandUnowned, workspaceChangeReleased]);

export const unattributedWrites = writes('CommandUnattributed', [commandUnattributed]);

export const lessonWrites = writes('CommandLessons', [commandSignature]);
