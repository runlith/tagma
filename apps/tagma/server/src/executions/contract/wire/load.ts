import { Schema } from 'effect';
import { EvidenceScope, InstallationRole, MachineMemory } from '@runlith/executions/protocol/evidence';
import { ExecutionRef } from '@runlith/executions/protocol/execution';
import { ThreadId } from '../../../platform/contract/wire/thread.js';
import { BackgroundWork } from '../../../platform/contract/wire/background.js';
import { PageId } from '../../../browser/contract/wire/ids.js';

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
  others: Schema.optional(Schema.Boolean).annotate({
    description: 'Whether the reader shows other programs now, so processes the OS refuses to this user are read too.',
  }),
});
export type LoadInterest = typeof LoadInterest.Type;

export const LoadInterestTaken = Schema.Struct({ taken: Schema.Boolean });
export type LoadInterestTaken = typeof LoadInterestTaken.Type;

export const AppViewDocument = Schema.Struct({
  _tag: Schema.Literal('AppView'),
  project: Schema.Int.check(Schema.isGreaterThan(0)),
  app: Schema.NonEmptyString,
  view: Schema.NonEmptyString,
});

export const McpViewDocument = Schema.Struct({ _tag: Schema.Literal('McpView'), server: Schema.NonEmptyString });

export const WindowDocument = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Interface') }),
  Schema.Struct({ _tag: Schema.Literal('Page'), page: PageId }),
  AppViewDocument,
  McpViewDocument,
  Schema.Struct({ _tag: Schema.Literal('Origin'), origin: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type WindowDocument = typeof WindowDocument.Type;

export const WindowProcessKind = Schema.Literals(['main', 'graphics', 'utility', 'renderer']);
export type WindowProcessKind = typeof WindowProcessKind.Type;

export const WindowProcess = Schema.Struct({
  pid: Pid,
  createdMs: Schema.Number.check(Schema.isGreaterThan(0)).annotate({ description: 'When the process started, in epoch milliseconds.' }),
  kind: WindowProcessKind,
  documents: Schema.Array(WindowDocument),
});
export type WindowProcess = typeof WindowProcess.Type;

export const WindowDeclaration = Schema.Struct({
  precisionMs: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: 'How far a createdMs may stand from the kernel’s own start of its process.',
  }),
  processes: Schema.Array(WindowProcess),
});
export type WindowDeclaration = typeof WindowDeclaration.Type;

export const LoadProcess = Schema.Struct({
  pid: Pid,
  birth: Schema.NonEmptyString,
  parent: Schema.optional(Pid),
  execution: Schema.optional(Schema.NonEmptyString).annotate({
    description: 'The key of the live command or terminal this process belongs to, as its row work lists it.',
  }),
  name: Schema.NonEmptyString,
  command: Schema.optional(Schema.String),
  role: Schema.optional(InstallationRole).annotate({ description: 'Which part of Tagma this process is, on the installation row.' }),
  share: Schema.NullOr(Share),
  reapedShare: Schema.optional(Share).annotate({
    description:
      'Of share, the part spent by children this process ran and reaped between two readings, such as the git commands of the server.',
  }),
  gpu: Schema.optional(Share).annotate({
    description: 'Its GPU use, 1 being one GPU busy the whole interval; present only where the system measures it.',
  }),
  gpuUnread: Schema.optional(Schema.String).annotate({ description: 'Why its GPU share is not measured.' }),
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

export const LoadRowKind = Schema.Literals([
  'server',
  'host',
  'interface',
  'graphics',
  'renderer',
  'agent',
  'work',
  'overflow',
  'program',
  'kernel',
]);
export type LoadRowKind = typeof LoadRowKind.Type;

export const OWN_KINDS: ReadonlySet<LoadRowKind> = new Set([
  'server',
  'host',
  'interface',
  'graphics',
  'renderer',
  'agent',
  'work',
  'overflow',
]);

export const LoadPage = Schema.Struct({ page: PageId, projectId: Schema.Int });
export type LoadPage = typeof LoadPage.Type;

export const UnresolvedPart = Schema.Struct({
  title: Schema.NonEmptyString,
  pid: Pid,
  reason: Schema.Literals(['different', 'unknown']).annotate({
    description: 'different: the pid now names another process; unknown: the start of the process could not be read.',
  }),
});
export type UnresolvedPart = typeof UnresolvedPart.Type;

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
  gpu: Share.annotate({ description: 'The GPU use of its processes the system measured, 1 being one GPU busy the whole interval.' }),
  gpuUnread: Count.annotate({ description: 'How many of its processes have no GPU measurement.' }),
  minor: Schema.Boolean,
  processes: Schema.Array(LoadProcess),
  work: Schema.optional(LoadWork),
  close: Schema.optional(Schema.Array(LoadPage)).annotate({ description: 'The built-in browser pages this window process hosts.' }),
  lowerBound: Schema.optional(Schema.Boolean).annotate({
    description: 'The share misses processes born and gone between readings, so it is at least this much.',
  }),
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
  machine: Schema.NonEmptyString.annotate({ description: 'What this kind of machine is called, in the words of its system.' }),
  gpu: Schema.Union([
    Schema.Struct({ _tag: Schema.Literal('Measured') }),
    Schema.Struct({ _tag: Schema.Literal('Unavailable'), reason: Schema.String }),
  ])
    .pipe(Schema.toTaggedUnion('_tag'))
    .annotate({ description: 'Whether the system measures GPU for any process; Unavailable says why it measures none.' }),
  share: Schema.NullOr(Share),
  memory: MachineMemory,
  saturated: Schema.Boolean,
  rows: Schema.Array(LoadRow),
  totals: LoadTotals,
  top: Schema.optional(LoadTop),
  background: Schema.Array(BackgroundWork).annotate({
    description: "Work the server does on its own, inside the server row's share.",
  }),
  unresolved: Schema.Array(UnresolvedPart).annotate({
    description: 'Window processes that could not be matched to a process of the machine, so their load stands outside Tagma.',
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
