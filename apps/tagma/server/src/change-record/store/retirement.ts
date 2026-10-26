import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { workspaceChange } from './tables.js';
import { writes } from '../../platform/contract/service/writes.js';
import type { ReleasedSpan } from '../lines/released.js';
import type { DebtWindow } from '../lines/owed.js';
import type { DebtSource } from '../contract/wire/reshape.js';
import type { LandedPiece } from '../lines/landed.js';

export const checkoutSeen = sqliteTable('checkout_seen', {
  checkout: text('checkout').primaryKey(),
  head: text('head'),
});

export const changeLanding = sqliteTable(
  'change_landing',
  {
    checkout: text('checkout').notNull(),
    commit: text('commit').notNull(),
    tree: text('tree').notNull(),
  },
  (table) => [primaryKey({ columns: [table.checkout, table.commit] })],
);

export const changeLanded = sqliteTable(
  'change_landed',
  {
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    digest: text('digest').notNull(),
    head: text('head'),
    working: text('working'),
    pieces: text('pieces', { mode: 'json' }).$type<readonly LandedPiece[]>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.checkout, table.path, table.digest] })],
);

export const changeDebt = sqliteTable(
  'change_debt',
  {
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    commit: text('commit').notNull(),
    before: text('before'),
    after: text('after'),
    source: text('source').$type<DebtSource>().notNull().default('steps'),
    reason: text('reason').notNull(),
    windows: text('windows', { mode: 'json' }).$type<readonly DebtWindow[]>().notNull().default([]),
    at: integer('at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.checkout, table.path, table.commit, table.source] })],
);

export const releasedLine = sqliteTable(
  'released_line',
  {
    row: text('row')
      .primaryKey()
      .references(() => workspaceChange.id, { onDelete: 'cascade' }),
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    thread: text('thread').notNull(),
    reason: text('reason').notNull(),
    span: text('span', { mode: 'json' }).$type<ReleasedSpan>().notNull(),
  },
  (table) => [index('released_line_path_idx').on(table.checkout, table.path)],
);

export const retirementProof = sqliteTable(
  'retirement_proof',
  {
    row: text('row')
      .primaryKey()
      .references(() => workspaceChange.id, { onDelete: 'cascade' }),
    checkout: text('checkout').notNull(),
    path: text('path').notNull(),
    commit: text('commit').notNull(),
    after: text('after'),
    reason: text('reason', { enum: ['committed', 'overwritten'] }).notNull(),
    span: text('span', { mode: 'json' }).$type<ReleasedSpan>(),
  },
  (table) => [
    index('retirement_proof_checkout_idx').on(table.checkout, table.path),
    index('retirement_proof_commit_idx').on(table.checkout, table.commit),
  ],
);

export const retirementWrites = writes('ChangeRecord.retire', [checkoutSeen, workspaceChange, releasedLine, changeDebt, retirementProof]);
export const landingWrites = writes('ChangeRecord.landing', [changeLanding, changeLanded]);
export const debtWrites = writes('ChangeRecord.debt', [changeDebt]);
