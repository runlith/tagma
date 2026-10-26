import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const activity = sqliteTable(
  'activity',
  {
    id: text('id').primaryKey(),
    parent: text('parent'),
    parentRun: text('parent_run'),
    project: integer('project'),
    thread: text('thread'),
    run: text('run'),
    kind: text('kind').notNull(),
    actor: text('actor').notNull(),
    trigger: text('trigger'),
    attrs: text('attrs').notNull(),
    openedAt: integer('opened_at').notNull(),
    endedAt: integer('ended_at'),
    outcome: text('outcome'),
    reason: text('reason'),
    message: text('message'),
    result: text('result'),
    provider: text('provider'),
    model: text('model'),
    rung: text('rung'),
    account: text('account'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    folded: text('folded'),
  },
  (table) => [
    index('activity_project_at').on(table.project, table.openedAt),
    index('activity_thread_at').on(table.thread, table.openedAt),
    index('activity_parent').on(table.parent),
    index('activity_run').on(table.run),
    index('activity_ended').on(table.endedAt),
    index('activity_opened').on(table.openedAt),
  ],
);

export const note = sqliteTable(
  'note',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    activity: text('activity').notNull(),
    at: integer('at').notNull(),
    body: text('body').notNull(),
    folded: text('folded'),
  },
  (table) => [
    index('note_activity').on(table.activity),
    index('note_at').on(table.at),
    index('note_fault')
      .on(table.at)
      .where(sql`json_extract(body, '$.type') in ('defect', 'degraded')`),
  ],
);

export const mark = sqliteTable('mark', {
  name: text('name').primaryKey(),
  at: integer('at').notNull(),
});

export const body = sqliteTable(
  'body',
  {
    activity: text('activity').notNull(),
    n: integer('n').notNull(),
    kind: text('kind').notNull(),
    at: integer('at').notNull(),
    bucket: text('bucket').notNull(),
    bytes: integer('bytes').notNull(),
    size: integer('size').notNull().default(0),
    contentType: text('content_type').notNull().default('application/json'),
    state: text('state').notNull(),
    form: text('form').notNull().default('value'),
    baseActivity: text('base_activity'),
    baseN: integer('base_n'),
  },
  (table) => [
    primaryKey({ columns: [table.activity, table.n] }),
    index('body_bucket').on(table.bucket),
    index('body_at').on(table.at),
    index('body_base').on(table.baseActivity, table.baseN),
  ],
);

export const bucket = sqliteTable('bucket', {
  bucket: text('bucket').primaryKey(),
  bytes: integer('bytes').notNull(),
  bodies: integer('bodies').notNull(),
});

export const reading = sqliteTable(
  'reading',
  {
    id: text('id').primaryKey(),
    question: text('question').notNull(),
    expires: integer('expires').notNull(),
    matched: integer('matched').notNull(),
    total: integer('total').notNull(),
    threads: integer('threads').notNull(),
  },
  (table) => [index('reading_expires').on(table.expires)],
);

export const readingRow = sqliteTable(
  'reading_row',
  {
    reading: text('reading').notNull(),
    n: integer('n').notNull(),
    identity: text('identity'),
    answer: text('answer'),
  },
  (table) => [primaryKey({ columns: [table.reading, table.n] }), index('reading_identity').on(table.reading, table.identity)],
);

export const readingMember = sqliteTable(
  'reading_member',
  {
    reading: text('reading').notNull(),
    thread: text('thread').notNull(),
    expires: integer('expires').notNull(),
  },
  (table) => [primaryKey({ columns: [table.reading, table.thread] }), index('reading_member_expires').on(table.expires)],
);

export const upgrade = sqliteTable('upgrade', {
  name: text('name').primaryKey(),
  finishedAt: integer('finished_at').notNull(),
});

export const loss = sqliteTable(
  'loss',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    until: integer('until').notNull().default(0),
    unknown: integer('unknown').notNull().default(0),
    cause: text('cause').notNull(),
    facts: integer('facts').notNull(),
    bodies: integer('bodies').notNull(),
    bytes: integer('bytes').notNull(),
  },
  (table) => [index('loss_at').on(table.at), index('loss_until').on(table.until)],
);
