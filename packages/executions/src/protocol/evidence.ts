import { Schema } from 'effect';
import { NativeRelation } from './capacity';
import { ExecutionRef } from './execution';

const Millis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Micros = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Pid = Schema.Int.check(Schema.isGreaterThan(0));

export const EvidenceNamespace = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Local'), machine: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.Literal('Foreign'), kind: Schema.Literals(['guest', 'remote']), id: Schema.NonEmptyString }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type EvidenceNamespace = typeof EvidenceNamespace.Type;

export const EvidenceScope = Schema.Struct({ host: EvidenceNamespace, network: EvidenceNamespace });
export type EvidenceScope = typeof EvidenceScope.Type;

export const sameNamespace = (left: EvidenceNamespace, right: EvidenceNamespace): boolean =>
  left._tag === 'Local'
    ? right._tag === 'Local' && left.machine === right.machine
    : right._tag === 'Foreign' && left.kind === right.kind && left.id === right.id;

export const sameScope = (left: EvidenceScope, right: EvidenceScope): boolean =>
  sameNamespace(left.host, right.host) && sameNamespace(left.network, right.network);

export const EvidenceSource = Schema.Struct({ adapter: Schema.NonEmptyString, probe: Schema.NonEmptyString });
export type EvidenceSource = typeof EvidenceSource.Type;

export const EvidenceCompleteness = Schema.Literals(['complete', 'partial', 'unavailable']);
export type EvidenceCompleteness = typeof EvidenceCompleteness.Type;

export const UnmeasuredReason = Schema.Literals(['unsupported', 'refused', 'failed', 'timeout', 'truncated', 'unknown']);
export type UnmeasuredReason = typeof UnmeasuredReason.Type;

export const UnmeasuredRegion = Schema.Struct({
  region: Schema.NonEmptyString,
  reason: UnmeasuredReason,
  detail: Schema.String,
});
export type UnmeasuredRegion = typeof UnmeasuredRegion.Type;

const observation = Schema.Struct({
  scope: EvidenceScope,
  source: EvidenceSource,
  observedAt: Millis,
  completeness: EvidenceCompleteness,
  unmeasured: Schema.Array(UnmeasuredRegion),
});

export const ProcessWitness = Schema.Struct({ pid: Pid, birth: Schema.NonEmptyString });
export type ProcessWitness = typeof ProcessWitness.Type;

export const ProcessIdentity = Schema.Struct({ pid: Pid, birth: Schema.optional(Schema.NonEmptyString) });
export type ProcessIdentity = typeof ProcessIdentity.Type;

export const sameProcess = (left: ProcessIdentity, right: ProcessIdentity): boolean =>
  left.pid === right.pid && left.birth !== undefined && left.birth === right.birth;

export const IdentityMatch = Schema.Literals(['same', 'different', 'unknown']);
export type IdentityMatch = typeof IdentityMatch.Type;

export const identityMatch = (expected: ProcessIdentity | undefined, read: ProcessIdentity | undefined): IdentityMatch => {
  if (expected?.birth === undefined || read?.birth === undefined) return 'unknown';
  return sameProcess(expected, read) ? 'same' : 'different';
};

export const ProcessAssociation = Schema.Struct({
  execution: ExecutionRef,
  relation: NativeRelation,
  identity: IdentityMatch,
});
export type ProcessAssociation = typeof ProcessAssociation.Type;

export const ProcessSnapshot = Schema.Struct({
  ...observation.fields,
  identity: ProcessIdentity,
  parent: Schema.optional(Pid),
  work: Schema.optional(Pid),
  terminal: Schema.optional(Schema.NonEmptyString),
  state: Schema.optional(Schema.NonEmptyString),
  command: Schema.optional(Schema.String),
  association: Schema.optional(ProcessAssociation),
});
export type ProcessSnapshot = typeof ProcessSnapshot.Type;

export const ListenerProtocol = Schema.Literals(['tcp', 'udp']);
export type ListenerProtocol = typeof ListenerProtocol.Type;

export const ListenerHint = Schema.Struct({ url: Schema.NonEmptyString, source: Schema.Literal('output') });
export type ListenerHint = typeof ListenerHint.Type;

export const ListenerSnapshot = Schema.Struct({
  ...observation.fields,
  protocol: ListenerProtocol,
  address: Schema.NonEmptyString,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  holder: ProcessIdentity,
  association: Schema.optional(ProcessAssociation),
  hint: Schema.optional(ListenerHint),
});
export type ListenerSnapshot = typeof ListenerSnapshot.Type;

export const EvidenceSubject = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Execution'), execution: ExecutionRef }),
  Schema.Struct({ _tag: Schema.Literal('Namespace') }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type EvidenceSubject = typeof EvidenceSubject.Type;

export const EvidenceRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type EvidenceRevision = typeof EvidenceRevision.Type;

export const ProcessReport = Schema.Struct({
  ...observation.fields,
  revision: EvidenceRevision,
  subject: EvidenceSubject,
  processes: Schema.Array(ProcessSnapshot),
});
export type ProcessReport = typeof ProcessReport.Type;

export const MemoryKind = Schema.Literals(['footprint', 'pss', 'private', 'resident']);
export type MemoryKind = typeof MemoryKind.Type;

export const ProcessUsageRow = Schema.Struct({
  identity: ProcessIdentity,
  parent: Schema.optional(Pid),
  work: Schema.optional(Pid),
  cpuMicros: Micros,
  residentBytes: Bytes,
  memoryKind: Schema.optional(MemoryKind),
  footprintBytes: Schema.optional(Bytes),
  association: Schema.optional(ProcessAssociation),
});
export type ProcessUsageRow = typeof ProcessUsageRow.Type;

export const UsageRateGap = Schema.Literals([
  'first-sample',
  'counter-reset',
  'identity-changed',
  'identity-unproven',
  'population-changed',
  'interval-empty',
  'unmeasured',
]);
export type UsageRateGap = typeof UsageRateGap.Type;

export const UsageGap = Schema.Struct({
  reason: UsageRateGap,
  pid: Schema.optional(Pid),
  detail: Schema.String,
});
export type UsageGap = typeof UsageGap.Type;

export const UsageRate = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Measured'),
    cores: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
    overMicros: Schema.Int.check(Schema.isGreaterThan(0)),
    population: Schema.Struct({
      matched: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      born: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      departed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      dropped: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    }),
    completeness: Schema.optional(Schema.Literals(['complete', 'partial'])),
    gaps: Schema.optional(Schema.Array(UsageGap)),
    basis: Schema.optional(Schema.Literals(['interval', 'lifetime'])),
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ _tag: Schema.Literal('Unknown'), reason: UsageRateGap, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type UsageRate = typeof UsageRate.Type;

export const UsageMemory = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('ResidentSum'),
    bytes: Bytes,
    processes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    kind: Schema.optional(MemoryKind),
    footprintBytes: Schema.optional(Bytes),
  }),
  Schema.Struct({ _tag: Schema.Literal('Unknown'), reason: UnmeasuredReason, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type UsageMemory = typeof UsageMemory.Type;

export const UsageFootprint = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Measured'),
    kind: Schema.Literals(['footprint', 'pss', 'private']),
    bytes: Bytes,
    processes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({ _tag: Schema.Literal('Unknown'), reason: UnmeasuredReason, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type UsageFootprint = typeof UsageFootprint.Type;

export const UsageReading = Schema.Struct({
  ...observation.fields,
  execution: ExecutionRef,
  revision: EvidenceRevision,
  takenAtMicros: Micros,
  coverage: Schema.Array(NativeRelation),
  processes: Schema.Array(ProcessUsageRow),
  current: Schema.optional(ProcessWitness),
  cpu: UsageRate,
  memory: UsageMemory,
  footprint: Schema.optional(UsageFootprint),
});
export type UsageReading = typeof UsageReading.Type;

export const MemoryPressure = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Measured'),
    level: Schema.Literals(['normal', 'warning', 'critical']),
    source: EvidenceSource,
    value: Schema.optional(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  Schema.Struct({ _tag: Schema.Literal('Unknown'), reason: UnmeasuredReason, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type MemoryPressure = typeof MemoryPressure.Type;

export const MachineMemory = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Measured'),
    totalBytes: Bytes,
    usedBytes: Bytes,
    availableBytes: Bytes,
    source: EvidenceSource,
    pressure: MemoryPressure,
  }),
  Schema.Struct({ _tag: Schema.Literal('Unknown'), reason: UnmeasuredReason, detail: Schema.String }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type MachineMemory = typeof MachineMemory.Type;

const Cores = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const InstallationRole = Schema.Literals(['window', 'server', 'host', 'holder']);
export type InstallationRole = typeof InstallationRole.Type;

export const LoadProcess = Schema.Struct({
  identity: ProcessWitness,
  parent: Schema.optional(Pid),
  name: Schema.NonEmptyString,
  command: Schema.optional(Schema.String),
  role: Schema.optional(InstallationRole),
  cores: Schema.NullOr(Cores),
  reapedCores: Schema.optional(Cores).annotate({
    description: 'Of cores, the part spent by children this process ran and reaped between two readings.',
  }),
  memoryBytes: Schema.NullOr(Bytes),
  signal: Schema.Boolean,
  unread: Schema.optional(Schema.String),
});
export type LoadProcess = typeof LoadProcess.Type;

export const DeclaredPart = Schema.Struct({
  key: Schema.NonEmptyString,
  pid: Pid,
  createdMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  precisionMs: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type DeclaredPart = typeof DeclaredPart.Type;

const UnresolvedPart = Schema.Struct({ part: DeclaredPart, reason: Schema.Literals(['different', 'unknown']) });

export const LoadInterest = Schema.Struct({ interested: Schema.Boolean, others: Schema.Boolean });
export type LoadInterest = typeof LoadInterest.Type;

export const GroupOwner = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Execution'), execution: ExecutionRef, ended: Schema.Boolean }),
  Schema.Struct({ _tag: Schema.Literal('Part'), key: Schema.NonEmptyString }),
  Schema.Struct({ _tag: Schema.Literal('Installation') }),
  Schema.Struct({
    _tag: Schema.Literal('Program'),
    key: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    where: Schema.optional(Schema.NonEmptyString),
  }),
  Schema.Struct({ _tag: Schema.Literal('Kernel') }),
]).pipe(Schema.toTaggedUnion('_tag'));
export type GroupOwner = typeof GroupOwner.Type;

export const LoadGroup = Schema.Struct({
  owner: GroupOwner,
  cores: Cores,
  memoryBytes: Bytes,
  unread: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  processes: Schema.Array(LoadProcess),
  lowerBound: Schema.optional(Schema.Boolean),
});
export type LoadGroup = typeof LoadGroup.Type;

export const LoadReading = Schema.Struct({
  scope: EvidenceScope,
  observedAt: Millis,
  revision: EvidenceRevision,
  takenAtMicros: Micros,
  overMicros: Micros,
  cores: Schema.Int.check(Schema.isGreaterThan(0)),
  machineName: Schema.NonEmptyString,
  unresolvedParts: Schema.Array(UnresolvedPart),
  cpu: Schema.NullOr(Cores),
  memory: MachineMemory,
  groups: Schema.Array(LoadGroup),
  unread: Schema.optional(Schema.String),
});
export type LoadReading = typeof LoadReading.Type;

export const ListenerReport = Schema.Struct({
  ...observation.fields,
  revision: EvidenceRevision,
  subject: EvidenceSubject,
  listeners: Schema.Array(ListenerSnapshot),
});
export type ListenerReport = typeof ListenerReport.Type;
