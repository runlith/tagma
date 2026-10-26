import { Schema } from 'effect';
import { EvidenceScope, InstallationRole, MachineMemory } from '@runlith/executions/protocol/evidence';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { BackgroundWork } from '../../../platform/contract/wire/background.js';

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Pid = Schema.Int.check(Schema.isGreaterThan(0));
const Share = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const MachineLoadSubscription = Schema.Struct({});
export type MachineLoadSubscription = typeof MachineLoadSubscription.Type;

export const LoadReader = Schema.NonEmptyString.pipe(Schema.brand('LoadReader'));
export type LoadReader = typeof LoadReader.Type;

export const LoadInterest = Schema.Struct({
  reader: LoadReader,
  interested: Schema.Boolean,
});
export type LoadInterest = typeof LoadInterest.Type;

export const LoadInterestTaken = Schema.Struct({ taken: Schema.Boolean });
export type LoadInterestTaken = typeof LoadInterestTaken.Type;

export const LoadProcess = Schema.Struct({
  pid: Pid,
  birth: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  command: Schema.optional(Schema.String),
  role: Schema.optional(InstallationRole).annotate({ description: 'Which part of Tagma this process is, on the installation row.' }),
  share: Schema.NullOr(Share),
  reapedShare: Schema.optional(Share).annotate({
    description:
      'Of share, the part spent by children this process ran and reaped between two readings, such as the git commands of the server.',
  }),
  memoryBytes: Schema.NullOr(Count),
  killable: Schema.Boolean,
  unread: Schema.optional(Schema.String),
});
export type LoadProcess = typeof LoadProcess.Type;

export const LoadExecution = Schema.Struct({
  projectId: Schema.Int,
  key: Schema.NonEmptyString,
  kind: Schema.Literals(['command', 'terminal']).annotate({ description: 'Which record holds it, and so which stop ends it.' }),
  transport: Schema.Literals(['pipes', 'pty']),
  execution: ExecutionRef,
  session: Schema.Boolean.annotate({ description: "The thread's own harness session, not work the thread started." }),
  label: Schema.NonEmptyString,
  share: Schema.NullOr(Share),
  memoryBytes: Count,
});
export type LoadExecution = typeof LoadExecution.Type;

export const LoadResidual = Schema.Struct({ origin: ExecutionRef, pid: Pid });
export type LoadResidual = typeof LoadResidual.Type;

export const LoadWork = Schema.Struct({
  executions: Schema.Array(LoadExecution),
  residuals: Schema.Array(LoadResidual),
});
export type LoadWork = typeof LoadWork.Type;

export const LoadProject = Schema.Struct({ id: Schema.Int, name: Schema.NonEmptyString });
export type LoadProject = typeof LoadProject.Type;

export const LoadRowKind = Schema.Literals(['installation', 'agent', 'work', 'program', 'kernel']);
export type LoadRowKind = typeof LoadRowKind.Type;

export const OWN_KINDS: ReadonlySet<LoadRowKind> = new Set(['installation', 'agent', 'work']);

export const LoadRow = Schema.Struct({
  key: Schema.NonEmptyString,
  kind: LoadRowKind,
  title: Schema.NonEmptyString,
  detail: Schema.optional(Schema.String),
  project: Schema.optional(LoadProject),
  thread: Schema.optional(ThreadId),
  share: Share,
  rank: Share,
  memoryBytes: Count,
  unread: Count,
  minor: Schema.Boolean,
  processes: Schema.Array(LoadProcess),
  work: Schema.optional(LoadWork),
});
export type LoadRow = typeof LoadRow.Type;

export const LoadTotal = Schema.Struct({
  count: Count,
  share: Schema.NullOr(Share),
  memoryBytes: Schema.NullOr(Count),
  unread: Count,
});
export type LoadTotal = typeof LoadTotal.Type;

export const LoadTotals = Schema.Struct({
  own: LoadTotal,
  agent: LoadTotal,
  work: LoadTotal,
  outside: LoadTotal,
  others: LoadTotal,
});
export type LoadTotals = typeof LoadTotals.Type;

export const LoadTop = Schema.Struct({ key: Schema.NonEmptyString, title: Schema.NonEmptyString, share: Share });
export type LoadTop = typeof LoadTop.Type;

export const LoadView = Schema.Struct({
  scope: EvidenceScope,
  readAt: Schema.Number,
  cores: Schema.Int.check(Schema.isGreaterThan(0)),
  share: Schema.NullOr(Share),
  memory: MachineMemory,
  saturated: Schema.Boolean,
  rows: Schema.Array(LoadRow),
  totals: LoadTotals,
  top: Schema.optional(LoadTop),
  background: Schema.Array(BackgroundWork).annotate({
    description: "Work the server does on its own, inside the installation row's share.",
  }),
  unread: Schema.optional(Schema.String),
});
export type LoadView = typeof LoadView.Type;

export const LoadPoint = Schema.Struct({
  at: Schema.Number,
  machine: Schema.NullOr(Share),
  own: Share,
  rows: Schema.Record(Schema.String, Share),
});
export type LoadPoint = typeof LoadPoint.Type;

export const MachineState = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Waiting') }),
  Schema.Struct({ _tag: Schema.Literal('Read'), view: LoadView }),
  Schema.Struct({ _tag: Schema.Literal('Lost'), reason: Schema.NonEmptyString, since: Schema.Number }),
  Schema.Struct({ _tag: Schema.Literal('Outdated'), reason: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type MachineState = typeof MachineState.Type;

export const MachineLoadSnapshot = Schema.Struct({
  composedAt: Schema.Number,
  reader: LoadReader,
  state: MachineState,
  history: Schema.Array(LoadPoint),
});
export type MachineLoadSnapshot = typeof MachineLoadSnapshot.Type;

export const MachineLoadDelta = Schema.Struct({
  composedAt: Schema.Number,
  state: MachineState,
  point: Schema.optional(LoadPoint),
});
export type MachineLoadDelta = typeof MachineLoadDelta.Type;

export const MachineLoadFrame = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Snapshot'), sequence: Sequence, snapshot: MachineLoadSnapshot }),
  Schema.Struct({
    _tag: Schema.Literal('Delta'),
    sequence: Schema.Int.check(Schema.isGreaterThan(0)),
    base: Sequence,
    delta: MachineLoadDelta,
  }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type MachineLoadFrame = typeof MachineLoadFrame.Type;

export const HISTORY_MS = 120_000;

export const keptHistory = (history: readonly LoadPoint[], point: LoadPoint | undefined): readonly LoadPoint[] => {
  if (point === undefined) return history;
  const from = point.at - HISTORY_MS;
  const kept = history.findIndex((one) => one.at >= from);
  return [...(kept === -1 ? [] : history.slice(kept)), point];
};

export const appliedMachineLoad = (before: MachineLoadSnapshot, delta: MachineLoadDelta): MachineLoadSnapshot => ({
  composedAt: delta.composedAt,
  reader: before.reader,
  state: delta.state,
  history: keptHistory(before.history, delta.point),
});
