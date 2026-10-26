import { type SQL, sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { project } from '../../projects/store/table.js';
import type { PreparedMerge } from '../../change-record/contract/service/prepared.js';
import type { SubmitReceipt } from '../contract/wire/receipt.js';

export const INTENT_PHASES = ['intended', 'publishing', 'published', 'settled', 'lost'] as const;

export type IntentPhase = (typeof INTENT_PHASES)[number];

export const INTENT_KINDS = ['preservation', 'landing', 'merge'] as const;

export type IntentKind = (typeof INTENT_KINDS)[number];

export const landingIntent = sqliteTable(
  'landing_intent',
  {
    key: text('key').primaryKey(),
    kind: text('kind', { enum: INTENT_KINDS }).notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    phase: text('phase', { enum: INTENT_PHASES }).notNull(),
    repository: text('repository').notNull(),
    checkout: text('checkout').notNull(),
    ref: text('ref').notNull(),
    base: text('base').notNull(),
    tree: text('tree').notNull(),
    merge: text('merge', { mode: 'json' }).$type<PreparedMerge>(),
    commit: text('commit'),
    witnessedAt: integer('witnessed_at', { mode: 'timestamp_ms' }),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('landing_intent_project_idx').on(table.projectId),
    index('landing_intent_open_idx')
      .on(table.kind, table.at, table.key)
      .where(sql`${table.phase} in ('intended', 'publishing', 'published')`),
    index('landing_intent_checkout_open_idx')
      .on(table.kind, table.checkout, table.at, table.key)
      .where(sql`${table.phase} in ('intended', 'publishing', 'published')`),
    index('landing_intent_ended_idx')
      .on(table.kind, table.at)
      .where(sql`${table.phase} in ('settled', 'lost')`),
  ],
);

export const opened: SQL = sql`${landingIntent.phase} in ('intended', 'publishing', 'published')`;

export const landingReceipt = sqliteTable('landing_receipt', {
  key: text('key')
    .primaryKey()
    .references(() => landingIntent.key, { onDelete: 'cascade' }),
  commit: text('commit').notNull(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull(),
});

export const submitReceipt = sqliteTable(
  'submit_receipt',
  {
    threadId: text('thread_id').notNull(),
    projectId: integer('project_id').notNull(),
    callId: text('call_id').notNull(),
    checkout: text('checkout').notNull(),
    ref: text('ref').notNull(),
    job: text('job').notNull(),
    commit: text('commit').notNull(),
    submitted: text('submitted', { mode: 'json' }).$type<SubmitReceipt>().notNull(),
    complete: integer('complete', { mode: 'boolean' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.threadId, table.projectId, table.callId] })],
);

export const MERGE_AFTER_STATES = ['waiting', 'running', 'done'] as const;

export type MergeAfterState = (typeof MERGE_AFTER_STATES)[number];

export const MERGE_SOURCE_STATES = ['none', 'pending', 'ref', 'done', 'unsynced', 'refused'] as const;

export type MergeSourceState = (typeof MERGE_SOURCE_STATES)[number];

export const mergeRequest = sqliteTable('merge_request', {
  key: text('key')
    .primaryKey()
    .references(() => landingIntent.key, { onDelete: 'cascade' }),
  request: text('request').notNull(),
  rootId: text('root_id').notNull(),
  baseRootId: text('base_root_id').notNull(),
  name: text('name').notNull(),
  branch: text('branch').notNull(),
  baseBranch: text('base_branch').notNull(),
  mode: text('mode', { enum: ['merge', 'squash', 'rebase'] }).notNull(),
  source: text('source').notNull(),
  after: text('after', { enum: ['keep', 'delete'] }).notNull(),
  end: text('end'),
  caller: text('caller'),
  callerProjectId: integer('caller_project_id'),
  waitedSince: integer('waited_since', { mode: 'timestamp_ms' }),
  afterState: text('after_state', { enum: MERGE_AFTER_STATES }).notNull(),
  afterOutcome: text('after_outcome', { enum: ['done', 'branch-kept', 'refused'] }),
  afterReason: text('after_reason'),
  sourcePath: text('source_path').notNull().default(''),
  sourceState: text('source_state', { enum: MERGE_SOURCE_STATES }).notNull().default('none'),
  sourceReason: text('source_reason'),
  rulesAfter: integer('rules_after', { mode: 'boolean' }).notNull().default(false),
});

export const mergeReceipt = sqliteTable(
  'merge_receipt',
  {
    rootId: text('root_id').notNull(),
    commit: text('commit').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    branch: text('branch').notNull(),
    base: text('base').notNull(),
    mode: text('mode', { enum: ['merge', 'squash', 'rebase'] }).notNull(),
    waitedSince: integer('waited_since', { mode: 'timestamp_ms' }),
    afterAct: text('after_act', { enum: ['keep', 'delete'] }).notNull(),
    afterOutcome: text('after_outcome', { enum: ['done', 'branch-kept', 'refused'] }).notNull(),
    afterReason: text('after_reason'),
    addressees: text('addressees', { mode: 'json' }).$type<readonly string[]>().notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.rootId, table.commit] }), index('merge_receipt_project_idx').on(table.projectId)],
);

export const worktreePendingMerge = sqliteTable(
  'worktree_pending_merge',
  {
    rootId: text('root_id').primaryKey(),
    projectId: integer('project_id').notNull(),
    mode: text('mode', { enum: ['merge', 'squash', 'rebase'] }).notNull(),
    message: text('message'),
    after: text('after', { enum: ['keep', 'delete'] }).notNull(),
    state: text('state', { enum: ['waiting', 'stopped'] }).notNull(),
    queuedAt: integer('queued_at', { mode: 'timestamp_ms' }).notNull(),
    attempts: integer('attempts').notNull(),
    refusal: text('refusal'),
    stoppedOn: text('stopped_on'),
    endRunning: text('end_running'),
    caller: text('caller'),
    callerProjectId: integer('caller_project_id'),
  },
  (table) => [index('worktree_pending_merge_project_idx').on(table.projectId)],
);
