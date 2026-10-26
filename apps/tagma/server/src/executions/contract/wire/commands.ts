import { Schema } from 'effect';
import { handle } from '@runlith/utils/printed';
import { CommandLimits, CommandPrograms, CommandRequested, CommandRuleCopy, LimitProvenance } from '@runlith/executions/protocol/command';
import { Principal } from '@runlith/executions/protocol/custody';
import { ExecutionRef, NativeExit } from '@runlith/executions/protocol/execution';
import { CommandEntry, InventoryRevision, UnmeasuredCoverage } from '@runlith/executions/protocol/inventory';
import { ProcessIdentity } from '@runlith/executions/protocol/evidence';
import { HostMemory } from '@runlith/executions/protocol/runtime';
import { ByteOffset } from '@runlith/executions/protocol/record';
import { PageCursor } from '@runlith/paging';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { RootId } from '../../../workspace/contract/wire/ids.js';
import { CommandSubject } from './commandSubject.js';
import { OperationKeyRetention } from './requestKeys.js';
import { TargetKey } from './targets.js';
import { TerminalHoldings } from './terminals.js';

export const CommandTimeRecord = Schema.Struct({
  tool: Schema.NonEmptyString,
  requested: Schema.optional(CommandRequested),
  rules: Schema.Array(CommandRuleCopy),
  programs: Schema.optional(CommandPrograms),
  life: Schema.optional(Schema.Struct({ ms: Schema.Int.check(Schema.isGreaterThan(0)), origin: LimitProvenance })),
  waitMs: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type CommandTimeRecord = typeof CommandTimeRecord.Type;

export const CommandPolicyReceipt = Schema.Struct({
  limits: CommandLimits,
  policyIdentity: Schema.NonEmptyString,
  time: CommandTimeRecord,
});
export type CommandPolicyReceipt = typeof CommandPolicyReceipt.Type;

export const admissionTime = (time: CommandTimeRecord) => ({
  tool: time.tool,
  requested: time.requested,
  rules: time.rules.length === 0 ? undefined : time.rules,
  programs: time.programs,
});

export const COMMAND_WAIT_MODES = ['foreground', 'background'] as const;
export const CommandWaitMode = Schema.Literals(COMMAND_WAIT_MODES);
export type CommandWaitMode = typeof CommandWaitMode.Type;

export const CommandWait = Schema.Struct({
  execution: ExecutionRef,
  mode: CommandWaitMode,
  revision: Schema.Int,
});
export type CommandWait = typeof CommandWait.Type;

export const COMMAND_RESULT_SIGNAL = 'command-result';

export const CommandDelivery = Schema.Struct({
  execution: ExecutionRef,
  thread: ThreadId,
  signalId: Schema.NonEmptyString,
  text: Schema.optional(Schema.NonEmptyString),
  openedAt: Schema.Number,
});
export type CommandDelivery = typeof CommandDelivery.Type;

export const commandSignalId = (execution: ExecutionRef, toolCall: string | undefined): string =>
  `command:${execution.execution}:${execution.incarnation}${toolCall === undefined ? '' : `:${toolCall}`}`;

export const CommandCreator = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Thread'),
    thread: ThreadId,
    run: Schema.optional(Schema.NonEmptyString),
    toolCall: Schema.optional(Schema.NonEmptyString),
  }),
  Schema.Struct({ _tag: Schema.Literal('Operator') }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandCreator = typeof CommandCreator.Type;

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

export const commandLineOf = (program: string, args: readonly string[]): string => {
  const slash = program.lastIndexOf('/');
  const name = slash === -1 ? program : program.slice(slash + 1);
  const [first, script] = args;
  if (SHELLS.has(name) && first === '-c' && script !== undefined && script !== '') return script;
  return [program, ...args].map(shellWord).join(' ');
};

const shellWord = (word: string): string => (word !== '' && /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`);

export const CommandIntentProvenance = Schema.Struct({
  serviceScope: Schema.optional(Schema.NonEmptyString),
  createdBy: Principal,
  createdRun: Schema.optional(Schema.NonEmptyString),
  createdToolCall: Schema.optional(Schema.NonEmptyString),
  policyIdentity: Schema.NonEmptyString,
  wait: CommandWaitMode,
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  program: Schema.optional(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
  time: Schema.optional(CommandTimeRecord),
});
export type CommandIntentProvenance = typeof CommandIntentProvenance.Type;

export const CommandRecord = Schema.Struct({
  projectId: Schema.Int,
  execution: ExecutionRef,
  owner: CommandSubject,
  origin: CommandCreator,
  policyIdentity: Schema.NonEmptyString,
  targetKey: TargetKey,
  holdings: TerminalHoldings,
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  program: Schema.optional(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
  time: Schema.optional(CommandTimeRecord),
  rootId: Schema.optional(RootId),
  admittedAt: Schema.Number,
});
export type CommandRecord = typeof CommandRecord.Type;

export const commandDeliveryOwed = (record: CommandRecord, mode: CommandWaitMode, at: number): CommandDelivery | null => {
  if (mode !== 'background' || record.origin._tag !== 'Thread') return null;
  return {
    execution: record.execution,
    thread: record.origin.thread,
    signalId: commandSignalId(record.execution, record.origin.toolCall),
    openedAt: at,
  };
};

export const CommandView = Schema.Struct({
  projectId: Schema.Int,
  execution: ExecutionRef,
  owner: CommandSubject,
  origin: CommandCreator,
  policyIdentity: Schema.NonEmptyString,
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  program: Schema.optional(Schema.NonEmptyString),
  cwd: Schema.optional(Schema.NonEmptyString),
  time: Schema.optional(CommandTimeRecord),
  rootId: Schema.optional(RootId),
  admittedAt: Schema.Number,
});
export type CommandView = typeof CommandView.Type;

export const CommandLive = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Held'), entry: CommandEntry, readAt: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal('Unheld') }),
  Schema.Struct({ _tag: Schema.Literal('Unavailable'), detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandLive = typeof CommandLive.Type;

export const commandStartedAt = (entry: CommandEntry, readAt: number): number | undefined => {
  const deadline = entry.deadline;
  if (deadline.armed === undefined) return undefined;
  if (deadline.executionMs !== undefined) return deadline.expiresAt === undefined ? undefined : deadline.expiresAt - deadline.executionMs;
  if (deadline.elapsedMs === undefined || entry.state.phase !== 'running') return undefined;
  return readAt - deadline.elapsedMs;
};

export const CommandCurrent = Schema.Struct({
  identity: ProcessIdentity,
  command: Schema.optional(Schema.NonEmptyString),
});
export type CommandCurrent = typeof CommandCurrent.Type;

export const CommandReading = Schema.Struct({
  command: CommandView,
  wait: Schema.optional(CommandWait),
  live: CommandLive,
  current: Schema.optional(CommandCurrent),
});
export type CommandReading = typeof CommandReading.Type;

export const COMMAND_ORDERS = ['oldest', 'newest'] as const;
export const CommandOrder = Schema.Literals(COMMAND_ORDERS);
export type CommandOrder = typeof CommandOrder.Type;

export const CommandCursor = Schema.NonEmptyString.pipe(Schema.brand('CommandCursor')).annotate(handle());
export type CommandCursor = typeof CommandCursor.Type;

export const CommandHostAnswer = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Answered'),
    revision: Schema.optional(InventoryRevision),
    memory: HostMemory,
    unmeasured: Schema.Array(UnmeasuredCoverage),
  }),
  Schema.Struct({ _tag: Schema.Literal('Unavailable'), detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type CommandHostAnswer = typeof CommandHostAnswer.Type;

export const CommandListAnswer = Schema.Struct({
  readings: Schema.Array(CommandReading),
  after: Schema.optional(CommandCursor),
  host: CommandHostAnswer,
  operationKeys: OperationKeyRetention,
});
export type CommandListAnswer = typeof CommandListAnswer.Type;

export const CommandSelection = Schema.Struct({
  owner: Schema.optional(CommandSubject),
  standing: Schema.optional(Schema.Boolean),
  order: Schema.optional(CommandOrder),
  after: Schema.optional(CommandCursor),
  limit: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type CommandSelection = typeof CommandSelection.Type;

export const OUTPUT_STREAMS = ['stdout', 'stderr'] as const;
export type OutputStream = (typeof OUTPUT_STREAMS)[number];

export const OUTPUT_COLUMNS = 500;

export const OutputStanding = Schema.Struct({
  execution: ExecutionRef,
  label: Schema.optional(Schema.NonEmptyString),
  commandLine: Schema.optional(Schema.NonEmptyString),
  phase: Schema.Literals(['queued', 'running', 'ended', 'unheld', 'unavailable']),
  exit: Schema.optional(NativeExit),
  elapsedMs: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type OutputStanding = typeof OutputStanding.Type;

const lineNumber = Schema.Int.check(Schema.isGreaterThan(0));

const OutputLine = Schema.Struct({ line: lineNumber, text: Schema.String });

export const OutputMatch = Schema.Struct({
  stream: Schema.Literals(OUTPUT_STREAMS),
  line: lineNumber,
  offset: ByteOffset,
  text: Schema.String,
  before: Schema.Array(OutputLine),
  after: Schema.Array(OutputLine),
});
export type OutputMatch = typeof OutputMatch.Type;

export const CommandSearchReading = Schema.Struct({
  ...OutputStanding.fields,
  matches: Schema.Array(OutputMatch),
  shown: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  next: Schema.NullOr(PageCursor),
  searched: Schema.Array(Schema.Struct({ stream: Schema.Literals(OUTPUT_STREAMS), from: ByteOffset, through: ByteOffset })),
});
export type CommandSearchReading = typeof CommandSearchReading.Type;

export const CommandOutputReading = Schema.Struct({
  ...OutputStanding.fields,
  output: Schema.String,
  skippedBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  first: Schema.Boolean,
  evicted: Schema.optional(Schema.Boolean),
  measurement: Schema.optional(Schema.NonEmptyString),
});
export type CommandOutputReading = typeof CommandOutputReading.Type;
