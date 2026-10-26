import { sql } from 'drizzle-orm';
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AdmissionPhase, Registration } from '@runlith/executions/protocol/registration';
import type { CallBudget, CallDecision, CallRetention, CancellationCause, SourceCompletion } from '@runlith/executions/protocol/call';
import type {
  Cleanup,
  ExecutionPhase,
  Lifetime,
  NativeExit,
  Purpose,
  RecordAvailability,
  StreamEnding,
  Transport,
} from '@runlith/executions/protocol/execution';
import type { CommandAdmission } from '@runlith/executions/protocol/command';
import type {
  ConfirmedEnding,
  ResidualResource,
  StopAction,
  StopCoverage,
  StreamEnding as StopStreamEnding,
  UnverifiableResource,
} from '@runlith/executions/protocol/stop';
import type { NativeRelation } from '@runlith/executions/protocol/capacity';
import type { BoundRuleRecord, CallTiming, OperationKind, OperationReceipt, StopIntent, StoredEcho } from './persisted';
import type { Descendant } from '../ProvenSet';
import type { Pace } from '@runlith/executions/protocol/pace';

export const incarnation = sqliteTable(
  'incarnation',
  {
    incarnation: integer('incarnation').primaryKey(),
    installation: text('installation').notNull(),
    registration: text('registration', { mode: 'json' }).$type<Registration>().notNull(),
    phase: text('phase').$type<AdmissionPhase>().notNull(),
    current: integer('current', { mode: 'boolean' }).notNull(),
    enteredAt: integer('entered_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    retiredAt: integer('retired_at', { mode: 'timestamp_ms' }),
    evicting: integer('evicting', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    uniqueIndex('incarnation_current_unique')
      .on(table.current)
      .where(sql`${table.current} = 1`),
  ],
);

export const generationLedger = sqliteTable('generation_ledger', {
  incarnation: integer('incarnation')
    .primaryKey()
    .references(() => incarnation.incarnation),
  bytes: integer('bytes').notNull().default(0),
  pending: integer('pending').notNull().default(0),
});

export const hostCustody = sqliteTable('host_custody', {
  installation: text('installation').primaryKey(),
  revision: integer('revision').notNull(),
  epoch: integer('epoch').notNull(),
  holderConnection: text('holder_connection'),
  holderIncarnation: integer('holder_incarnation'),
  operationId: text('operation_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const execution = sqliteTable(
  'execution',
  {
    executionId: text('execution_id').primaryKey(),
    installation: text('installation').notNull(),
    incarnation: integer('incarnation')
      .notNull()
      .references(() => incarnation.incarnation),
    transport: text('transport').$type<Transport>().notNull(),
    lifetime: text('lifetime').$type<Lifetime>().notNull(),
    purpose: text('purpose').$type<Purpose>().notNull(),
    phase: text('phase').$type<ExecutionPhase>().notNull(),
    nativeExit: text('native_exit', { mode: 'json' }).$type<NativeExit>(),
    stdout: text('stdout').$type<StreamEnding>().notNull(),
    stderr: text('stderr').$type<StreamEnding>().notNull(),
    pty: text('pty').$type<StreamEnding>().notNull(),
    cleanup: text('cleanup').$type<Cleanup>().notNull(),
    recordAvailability: text('record_availability').$type<RecordAvailability>().notNull(),
    command: text('command', { mode: 'json' }).$type<CommandAdmission>(),
    commandScope: text('command_scope'),
    commandOwner: text('command_owner'),
    commandCohort: text('command_cohort'),
    targetEnvironment: text('target_environment').notNull(),
    targetNamespace: text('target_namespace').notNull(),
    targetCwd: text('target_cwd').notNull(),
    pid: integer('pid'),
    terminal: text('terminal'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('execution_phase_idx').on(table.phase),
    index('execution_incarnation_idx').on(table.incarnation),
    index('execution_admitted_idx').on(table.createdAt, table.executionId),
    index('execution_command_idx').on(table.commandScope, table.commandOwner, table.commandCohort, table.createdAt, table.executionId),
  ],
);

export const executionDependency = sqliteTable(
  'execution_dependency',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => execution.executionId),
    position: integer('position').notNull(),
    receipt: text('receipt').notNull(),
  },
  (table) => [primaryKey({ columns: [table.executionId, table.position] })],
);

export const custody = sqliteTable('custody', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => execution.executionId),
  revision: integer('revision').notNull(),
  holder: text('holder').notNull(),
  origin: text('origin').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const operation = sqliteTable(
  'operation',
  {
    installation: text('installation').notNull(),
    operationId: text('operation_id').notNull(),
    incarnation: integer('incarnation'),
    kind: text('kind').$type<OperationKind>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    receipt: text('receipt', { mode: 'json' }).$type<OperationReceipt>().notNull(),
    executionId: text('execution_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.installation, table.operationId] }), index('operation_execution_idx').on(table.executionId)],
);

export const spentKey = sqliteTable(
  'spent_key',
  {
    installation: text('installation').notNull(),
    operationId: text('operation_id').notNull(),
    incarnation: integer('incarnation'),
    kind: text('kind').$type<OperationKind>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.installation, table.operationId] })],
);

export const stopIntent = sqliteTable(
  'stop_intent',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => execution.executionId),
    installation: text('installation').notNull(),
    operationId: text('operation_id').notNull(),
    incarnation: integer('incarnation').notNull(),
    cause: text('cause').$type<CancellationCause>().notNull(),
    coverage: text('coverage', { mode: 'json' }).$type<StopIntent['coverage']>().notNull(),
    requested: text('requested').$type<StopAction>().notNull(),
    joined: integer('joined', { mode: 'boolean' }).notNull(),
    requestedAt: integer('requested_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.installation, table.operationId] }),
    index('stop_intent_execution_idx').on(table.executionId),
    index('stop_intent_operation_idx').on(table.installation, table.operationId),
  ],
);

export const finalFacts = sqliteTable('final_facts', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => execution.executionId),
  installation: text('installation').notNull(),
  incarnation: integer('incarnation').notNull(),
  nativeExit: text('native_exit', { mode: 'json' }).$type<NativeExit>(),
  sources: text('sources', { mode: 'json' }).$type<SourceCompletion>().notNull(),
  cleanup: text('cleanup').$type<Cleanup>().notNull(),
  retention: text('retention').$type<CallRetention>().notNull(),
  confirmed: text('confirmed', { mode: 'json' }).$type<ReadonlyArray<ConfirmedEnding>>(),
  residual: text('residual', { mode: 'json' }).$type<ReadonlyArray<ResidualResource>>(),
  unverifiable: text('unverifiable', { mode: 'json' }).$type<ReadonlyArray<UnverifiableResource>>(),
  streams: text('streams', { mode: 'json' }).$type<ReadonlyArray<StopStreamEnding>>(),
  relation: text('relation').$type<StopCoverage>(),
  coverage: text('coverage', { mode: 'json' }).$type<ReadonlyArray<NativeRelation>>(),
  abandonedOutput: integer('abandoned_output', { mode: 'boolean' }),
  unacquired: text('unacquired'),
  recordedAt: integer('recorded_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const call = sqliteTable(
  'call',
  {
    installation: text('installation').notNull(),
    operationId: text('operation_id').notNull(),
    executionId: text('execution_id'),
    budget: text('budget', { mode: 'json' }).$type<CallBudget>().notNull(),
    started: text('started').$type<'native-acquired'>(),
    timing: text('timing', { mode: 'json' }).$type<CallTiming>(),
    sources: text('sources', { mode: 'json' }).$type<SourceCompletion>(),
    retention: text('retention').$type<CallRetention>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.installation, table.operationId] })],
);

export const executionPace = sqliteTable('execution_pace', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => execution.executionId),
  initial: text('initial').$type<Pace>().notNull(),
  target: text('target').$type<Pace>().notNull(),
  lowered: integer('lowered', { mode: 'boolean' }).notNull().default(false),
});

export const executionDeparture = sqliteTable('execution_departure', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => execution.executionId),
  accepted: text('accepted'),
  remainder: blob('remainder', { mode: 'buffer' }),
  ended: integer('ended', { mode: 'boolean' }),
  parsed: text('parsed'),
  descendants: text('descendants', { mode: 'json' }).$type<ReadonlyArray<Descendant>>().notNull(),
  echoes: text('echoes', { mode: 'json' }).$type<ReadonlyArray<StoredEcho>>().notNull(),
  lost: text('lost'),
});

export const executionRules = sqliteTable('execution_rules', {
  executionId: text('execution_id')
    .primaryKey()
    .references(() => execution.executionId),
  bound: text('bound', { mode: 'json' }).$type<ReadonlyArray<BoundRuleRecord>>().notNull(),
});

export const commandRevision = sqliteTable(
  'command_revision',
  {
    executionId: text('execution_id')
      .notNull()
      .references(() => execution.executionId),
    installation: text('installation').notNull(),
    incarnation: integer('incarnation').notNull(),
    revision: integer('revision').notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    executionMs: integer('execution_ms').notNull(),
    ceilingMs: integer('ceiling_ms'),
    actor: text('actor').notNull(),
    cause: text('cause').notNull(),
    exceptionActor: text('exception_actor'),
    exceptionCause: text('exception_cause'),
    outcome: text('outcome').notNull().default('pending'),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.executionId, table.revision] }),
    uniqueIndex('command_revision_operation_idx').on(table.installation, table.operationId),
  ],
);

export const callDecision = sqliteTable(
  'call_decision',
  {
    installation: text('installation').notNull(),
    operationId: text('operation_id').notNull(),
    decision: text('decision', { mode: 'json' }).$type<CallDecision>().notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [primaryKey({ columns: [table.installation, table.operationId] })],
);
