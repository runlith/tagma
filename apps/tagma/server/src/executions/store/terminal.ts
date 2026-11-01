import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { environmentUse } from '../../workspace/store/tables.js';
import { rootUse } from '../../workspace/store/tables.js';
import { project } from '../../projects/store/table.js';
import { threadRecord } from '../../thread-record/store/table.js';
import { TerminalIntentPhase, TerminalQuarantine } from '../contract/wire/terminals.js';
import { TerminalMutation } from '../contract/wire/requestKeys.js';
import { COMMAND_WAIT_MODES } from '../contract/wire/commands.js';

export const TERMINAL_OPERATION_OUTCOMES = ['pending', 'admitted', 'settled', 'uncertain', 'expired'] as const;

export const terminalRequestKeyTally = sqliteTable('terminal_request_key_tally', {
  outcome: text('outcome', { enum: TERMINAL_OPERATION_OUTCOMES }).primaryKey(),
  count: integer('count').notNull(),
});

export const terminalRequestKey = sqliteTable(
  'terminal_request_key',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    requester: text('requester').notNull(),
    mutation: text('mutation', { enum: TerminalMutation.literals }).notNull(),
    targetKey: text('target_key').notNull(),
    executionId: text('execution_id'),
    incarnation: integer('incarnation'),
    hostOperation: text('host_operation'),
    outcome: text('outcome', { enum: TERMINAL_OPERATION_OUTCOMES }).notNull(),
    uncertain: text('uncertain'),
    inputOutcome: text('input_outcome'),
    stopOutcome: text('stop_outcome'),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.operationId] }),
    index('terminal_operation_requester_idx').on(table.projectId, table.requester),
    index('terminal_operation_execution_idx').on(table.executionId),
    index('terminal_operation_occupancy_idx')
      .on(table.projectId)
      .where(sql`outcome != 'expired'`),
    index('terminal_operation_retention_idx').on(table.outcome, table.at, table.projectId, table.operationId),
  ],
);

export const terminalIntent = sqliteTable(
  'terminal_intent',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    operationId: text('operation_id').notNull(),
    phase: text('phase', { enum: TerminalIntentPhase.literals }).notNull(),
    rootUseId: text('root_use_id').references(() => rootUse.useId),
    environmentUseId: text('environment_use_id').references(() => environmentUse.useId),
    outgoingThread: text('outgoing_thread').references(() => threadRecord.id),
    incomingThread: text('incoming_thread').references(() => threadRecord.id),
    commandServiceScope: text('command_service_scope'),
    commandCreatedBy: text('command_created_by'),
    commandCreatedRun: text('command_created_run'),
    commandCreatedToolCall: text('command_created_tool_call'),
    commandPolicyIdentity: text('command_policy_identity'),
    commandWaitMode: text('command_wait_mode', { enum: COMMAND_WAIT_MODES }),
    commandLabel: text('command_label'),
    commandLine: text('command_line'),
    commandProgram: text('command_program'),
    commandCwd: text('command_cwd'),
    commandTime: text('command_time'),
    rootId: text('root_id'),
    launchedFor: text('launched_for'),
    shellKey: text('shell_key'),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.operationId] }),
    index('terminal_intent_outgoing_idx').on(table.outgoingThread),
    index('terminal_intent_incoming_idx').on(table.incomingThread),
    index('terminal_intent_root_use_idx').on(table.rootUseId),
    index('terminal_intent_environment_use_idx').on(table.environmentUseId),
  ],
);

export const terminal = sqliteTable(
  'terminal',
  {
    executionId: text('execution_id').primaryKey(),
    incarnation: integer('incarnation').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    transport: text('transport', { enum: ['pipes', 'pty'] }).notNull(),
    lifetime: text('lifetime', { enum: ['call', 'held'] }).notNull(),
    targetKey: text('target_key').notNull(),
    holder: text('holder').notNull(),
    origin: text('origin').notNull(),
    revision: integer('revision').notNull(),
    rootUseId: text('root_use_id').references(() => rootUse.useId),
    environmentUseId: text('environment_use_id').references(() => environmentUse.useId),
    heldByThread: text('held_by_thread'),
    label: text('label'),
    commandLine: text('command_line'),
    program: text('program'),
    cwd: text('cwd'),
    quarantine: text('quarantine', { enum: TerminalQuarantine.literals }),
    rootId: text('root_id'),
    launchedFor: text('launched_for'),
    shellKey: text('shell_key'),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }).notNull(),
    dischargedAt: integer('discharged_at', { mode: 'timestamp_ms' }),
    endedReason: text('ended_reason'),
  },
  (table) => [
    index('terminal_project_idx').on(table.projectId),
    index('terminal_root_use_idx').on(table.rootUseId),
    index('terminal_thread_idx').on(table.heldByThread),
    index('terminal_standing_idx').on(table.projectId, table.dischargedAt, table.acceptedAt),
    index('terminal_undischarged_idx')
      .on(table.acceptedAt)
      .where(sql`${table.dischargedAt} is null`),
    index('terminal_place_idx').on(table.projectId, table.rootId),
    uniqueIndex('terminal_shell_key_idx').on(table.shellKey),
  ],
);

export const openTerminal = sqliteTable(
  'open_terminal',
  {
    terminalId: text('terminal_id')
      .primaryKey()
      .references(() => terminal.executionId, { onDelete: 'cascade' }),
    incarnation: integer('incarnation').notNull(),
  },
  (table) => [index('open_terminal_incarnation_idx').on(table.incarnation)],
);

export const openTerminalProgress = sqliteTable('open_terminal_progress', {
  cursor: integer('cursor').notNull(),
  done: integer('done').notNull(),
});

export const terminalWriter = sqliteTable(
  'terminal_writer',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => terminal.executionId, { onDelete: 'cascade' }),
    incarnation: integer('incarnation').notNull(),
    writer: text('writer').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.executionId, table.incarnation, table.writer] })],
);

export const command = sqliteTable(
  'command',
  {
    executionId: text('execution_id').primaryKey(),
    incarnation: integer('incarnation').notNull(),
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    owner: text('owner').notNull(),
    ownerThread: text('owner_thread'),
    serviceScope: text('service_scope'),
    createdBy: text('created_by').notNull(),
    createdRun: text('created_run'),
    createdToolCall: text('created_tool_call'),
    policyIdentity: text('policy_identity').notNull(),
    targetKey: text('target_key').notNull(),
    label: text('label'),
    commandLine: text('command_line'),
    program: text('program'),
    cwd: text('cwd'),
    time: text('time'),
    rootUseId: text('root_use_id').references(() => rootUse.useId),
    environmentUseId: text('environment_use_id').references(() => environmentUse.useId),
    rootId: text('root_id'),
    admittedAt: integer('admitted_at', { mode: 'timestamp_ms' }).notNull(),
    endedReason: text('ended_reason'),
    measurement: text('measurement'),
  },
  (table) => [
    index('command_project_idx').on(table.projectId),
    index('command_root_use_idx').on(table.rootUseId),
    index('command_environment_use_idx').on(table.environmentUseId),
    index('command_thread_idx').on(table.ownerThread),
    index('command_owner_idx').on(table.projectId, table.ownerThread),
    index('command_page_idx').on(table.projectId, table.admittedAt, table.executionId),
    index('command_generation_owner_idx').on(table.incarnation, table.ownerThread),
  ],
);

export const commandFence = sqliteTable(
  'command_fence',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    ownerKey: text('owner_key').notNull(),
    revision: integer('revision').notNull(),
    movedAt: integer('moved_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.ownerKey] })],
);

export const commandWait = sqliteTable('command_wait', {
  executionId: text('execution_id').primaryKey(),
  incarnation: integer('incarnation').notNull(),
  mode: text('mode', { enum: COMMAND_WAIT_MODES }).notNull(),
  revision: integer('revision').notNull(),
  movedAt: integer('moved_at', { mode: 'timestamp_ms' }).notNull(),
});

export const commandDelivery = sqliteTable(
  'command_delivery',
  {
    executionId: text('execution_id').primaryKey(),
    incarnation: integer('incarnation').notNull(),
    threadId: text('thread_id').notNull(),
    signalId: text('signal_id').notNull(),
    text: text('text'),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
    readers: integer('readers').notNull().default(0),
  },
  (table) => [
    index('command_delivery_page_idx').on(table.openedAt, table.executionId),
    index('command_delivery_thread_idx').on(table.threadId),
  ],
);

export const custodyNotice = sqliteTable(
  'custody_notice',
  {
    projectId: integer('project_id').notNull(),
    operationId: text('operation_id').notNull(),
    threadId: text('thread_id').notNull(),
    requester: text('requester').notNull(),
    executionId: text('execution_id').notNull(),
    incarnation: integer('incarnation').notNull(),
    expected: integer('expected').notNull(),
    name: text('name').notNull(),
    state: text('state', { enum: ['intent', 'owed'] }).notNull(),
    openedAt: integer('opened_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.operationId] }), index('custody_notice_page_idx').on(table.openedAt)],
);
