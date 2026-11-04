import { Schema } from 'effect';
import { STOP_LADDER_MS } from './call';
import { Transport } from './execution';

const Budget = Schema.Int.check(Schema.isGreaterThan(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const TRANSFER_LIMIT = 16384;

export const ExecutionLimits = Schema.Struct({
  input: Schema.Struct({
    pendingBytes: Budget,
    chunkBytes: Budget,
    receipts: Budget,
  }),
  output: Schema.Struct({
    landingBytes: Budget,
    segmentBytes: Budget,
    retainedBytes: Budget,
  }),
  parser: Schema.Struct({
    pendingBytes: Budget,
    cellBytes: Budget,
  }),
  geometry: Schema.Struct({
    columns: Budget,
    rows: Budget,
    scrollbackRows: Budget,
  }),
  read: Schema.Struct({
    chunkBytes: Budget,
    readerCredits: Budget,
    readers: Budget,
  }),
  frame: Schema.Struct({
    bytes: Budget,
    inFlight: Budget,
  }),
  receipts: Budget,
});
export type ExecutionLimits = typeof ExecutionLimits.Type;

export const HostLimits = Schema.Struct({
  bindings: Budget,
  custodyReceipts: Budget,
  tombstones: Budget,
});
export type HostLimits = typeof HostLimits.Type;

export const UsagePolicy = Schema.Struct({
  periodMs: Budget,
});
export type UsagePolicy = typeof UsagePolicy.Type;

export const HostGrant = Schema.Struct({
  share: Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1)),
  machineBytes: Budget,
  grantBytes: Budget,
});
export type HostGrant = typeof HostGrant.Type;

export type KernelLimit = number | 'absent';

export type PlatformLimits = {
  readonly openFiles: KernelLimit;
  readonly holderFiles: KernelLimit;
  readonly processes: KernelLimit;
  readonly terminals: KernelLimit;
};

export type PlatformState = {
  readonly terminals: number;
  readonly processes: number;
  readonly descriptors: number;
  readonly holderDescriptors: number;
};

export type DescriptorExpenses = { readonly holder: number; readonly logic: number };

export type TransportDescriptors = Readonly<Record<Transport, DescriptorExpenses>>;

export type MachineLimits = {
  readonly granted: HostGrant;
  readonly descriptors: TransportDescriptors;
  readonly limits: PlatformLimits;
};

export type MachineReading = MachineLimits & {
  readonly standing: PlatformState;
};

export const HostCeilings = Schema.Struct({
  executions: Budget,
  terminals: Count,
  readers: Budget,
  reads: Budget,
  receipts: Budget,
  openFiles: Schema.Union([Count, Schema.Literal('absent')]),
  processes: Schema.Union([Count, Schema.Literal('absent')]),
  perTransport: Schema.Struct({ pipes: Count, pty: Count }),
});
export type HostCeilings = typeof HostCeilings.Type;

export const NativeRelation = Schema.Literals(['leader', 'work', 'terminal', 'ancestry']);
export type NativeRelation = typeof NativeRelation.Type;

export const HostPlatform = Schema.Struct({
  os: Schema.Literals(['darwin', 'linux', 'win32']),
  arch: Schema.NonEmptyString,
});
export type HostPlatform = typeof HostPlatform.Type;

const policy = Schema.Struct({
  transports: Schema.Array(Transport).check(Schema.isMinLength(1)),
  relations: Schema.Array(NativeRelation),
  execution: ExecutionLimits,
  host: HostLimits,
  usage: Schema.optional(UsagePolicy),
  shutdownMs: Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
});
export type ExecutionPolicy = typeof policy.Type;

export const offersCommands = (policy: { readonly transports: ReadonlyArray<Transport> }): boolean => policy.transports.includes('pipes');

const ENDING_READ_MS = 3_100;

export const SHUTDOWN_PHASE_MS = 2_000;

export const shutdownMsOf = (declared: number | undefined): number => declared ?? STOP_LADDER_MS + ENDING_READ_MS + SHUTDOWN_PHASE_MS;

const CELL_BYTES = 12;
const EXTENDED_ENTRY_BYTES = 48;
const REFLOW_LAYOUTS = 2;
const SCREENS = 2;

export const reserveOf = (limits: ExecutionLimits, transport: Transport): number => {
  const queues = limits.input.pendingBytes + limits.input.receipts * limits.input.chunkBytes;
  const reads = limits.read.readers * limits.read.chunkBytes;
  if (transport === 'pipes') return queues + 2 * limits.output.landingBytes + reads;
  const screen = REFLOW_LAYOUTS * SCREENS * limits.geometry.rows * limits.geometry.columns * (CELL_BYTES + EXTENDED_ENTRY_BYTES);
  return queues + screen + limits.parser.pendingBytes + limits.output.landingBytes + 2 * TRANSFER_LIMIT + reads;
};

const widestReserve = (profile: ExecutionPolicy): number =>
  reserveOf(profile.execution, profile.transports.includes('pty') ? 'pty' : 'pipes');

export const grantOf = (share: number, machineBytes: number): HostGrant => ({
  share,
  machineBytes,
  grantBytes: Math.floor(share * machineBytes),
});

export type CountLimit = {
  readonly limit: 'holder-descriptors' | 'logic-descriptors' | 'processes' | 'terminals';
  readonly transport?: Transport;
  readonly count: number;
  readonly detail: string;
};

const availableLimits = (machine: MachineReading): PlatformLimits => {
  const { limits, standing } = machine;
  const available = (limit: number | 'absent', held: number) => (limit === 'absent' ? limit : Math.max(0, limit - held));
  return {
    openFiles: available(limits.openFiles, standing.descriptors),
    holderFiles: available(limits.holderFiles, standing.holderDescriptors),
    processes: available(limits.processes, standing.processes),
    terminals: available(limits.terminals, standing.terminals),
  };
};

const limitTerms = (profile: ExecutionPolicy, descriptors: TransportDescriptors, limits: PlatformLimits): ReadonlyArray<CountLimit> => {
  const terms: CountLimit[] = [];
  for (const [owner, limit] of [
    ['holder', limits.holderFiles],
    ['logic', limits.openFiles],
  ] as const) {
    if (limit === 'absent') continue;
    for (const transport of profile.transports) {
      const expense = descriptors[transport][owner];
      terms.push({
        limit: owner === 'holder' ? 'holder-descriptors' : 'logic-descriptors',
        transport,
        count: Math.floor(limit / expense),
        detail: `${limit} ${owner} descriptors available, at ${expense} a ${transport} execution`,
      });
    }
  }
  if (limits.processes !== 'absent') {
    terms.push({
      limit: 'processes',
      count: limits.processes,
      detail: `${limits.processes} processes available to this user`,
    });
  }
  if (profile.transports.includes('pty') && limits.terminals !== 'absent') {
    terms.push({
      limit: 'terminals',
      count: limits.terminals,
      detail: `${limits.terminals} terminals available`,
    });
  }
  return terms;
};

export const countLimits = (profile: ExecutionPolicy, machine: MachineReading): ReadonlyArray<CountLimit> =>
  limitTerms(profile, machine.descriptors, availableLimits(machine));

export const executionTerms = (profile: ExecutionPolicy, machine: MachineReading): ReadonlyArray<CountLimit> =>
  countLimits(profile, machine).filter((term) => term.limit !== 'terminals');

export const maximumCeilingsOf = (profile: ExecutionPolicy, machine: MachineLimits): HostCeilings => deriveCeilings(profile, machine);

export const ceilingsOf = (profile: ExecutionPolicy, machine: MachineReading): HostCeilings =>
  deriveCeilings(profile, { ...machine, limits: availableLimits(machine) });

const deriveCeilings = (profile: ExecutionPolicy, machine: MachineLimits): HostCeilings => {
  const terms = limitTerms(profile, machine.descriptors, machine.limits);
  const ceilingOf = (transport: Transport) =>
    Math.min(
      Math.floor(machine.granted.grantBytes / reserveOf(profile.execution, transport)),
      ...terms
        .filter((term) => term.limit !== 'terminals' && (term.transport === undefined || term.transport === transport))
        .map((term) => term.count),
    );
  const perTransport = {
    pipes: profile.transports.includes('pipes') ? ceilingOf('pipes') : 0,
    pty: profile.transports.includes('pty') ? ceilingOf('pty') : 0,
  };
  const offered = profile.transports.map((transport) => perTransport[transport]);
  const executions = Math.min(...offered);
  const widest = Math.max(...offered);
  const terminals = terms.find((term) => term.limit === 'terminals');
  return {
    executions,
    terminals: profile.transports.includes('pty') ? Math.min(terminals?.count ?? perTransport.pty, perTransport.pty) : 0,
    readers: widest * profile.execution.read.readers,
    reads: widest * profile.execution.read.readers,
    receipts: widest * profile.execution.receipts,
    openFiles:
      machine.limits.openFiles === 'absent'
        ? machine.limits.holderFiles
        : machine.limits.holderFiles === 'absent'
          ? machine.limits.openFiles
          : Math.min(machine.limits.openFiles, machine.limits.holderFiles),
    processes: machine.limits.processes,
    perTransport,
  };
};

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

const policySizing = Schema.makeFilter((profile: ExecutionPolicy) => {
  const { execution } = profile;
  const issues: string[] = [];

  if (execution.input.chunkBytes > execution.input.pendingBytes) issues.push('input.chunkBytes exceeds input.pendingBytes');
  if (execution.output.landingBytes > execution.output.segmentBytes) issues.push('output.landingBytes exceeds output.segmentBytes');
  if (execution.output.segmentBytes + execution.output.landingBytes > execution.output.retainedBytes) {
    issues.push('output.retainedBytes cannot hold a segment plus the next landing chunk');
  }
  if (execution.read.chunkBytes > execution.output.retainedBytes) issues.push('read.chunkBytes exceeds output.retainedBytes');
  if (BigInt(widestReserve(profile)) > SAFE) {
    issues.push(`one execution reserves ${widestReserve(profile)} bytes, past exact integer arithmetic`);
  }
  return issues.length === 0 ? undefined : issues.join('; ');
});

export const ExecutionPolicy = policy.check(policySizing);

export const RuntimeIdentity = Schema.Struct({ name: Schema.NonEmptyString, version: Schema.NonEmptyString });
export type RuntimeIdentity = typeof RuntimeIdentity.Type;
export const NativeIdentity = Schema.Struct({ crate: Schema.NonEmptyString, version: Schema.NonEmptyString, build: Schema.NonEmptyString });
export type NativeIdentity = typeof NativeIdentity.Type;

const profileFields = Schema.Struct({
  version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  platform: HostPlatform,
  runtime: RuntimeIdentity,
  native: NativeIdentity,
  ...policy.fields,
  granted: HostGrant,
  ceilings: HostCeilings,
});

const profileSizing = Schema.makeFilter((profile: typeof profileFields.Type) => {
  const { ceilings, granted } = profile;
  const issues: string[] = [];
  const reserve = widestReserve(profile);

  if (granted.grantBytes > granted.machineBytes) issues.push('the grant is larger than the machine it was read from');
  if (granted.grantBytes < reserve) {
    issues.push(`a grant of ${granted.grantBytes} bytes cannot hold one execution's reserve of ${reserve}`);
  }
  if (ceilings.terminals > ceilings.perTransport.pty) issues.push('host terminals exceed the pty ceiling');
  if (ceilings.executions > Math.min(...profile.transports.map((transport) => ceilings.perTransport[transport])))
    issues.push('the guaranteed executions exceed a transport ceiling');
  if (ceilings.terminals > 0 && !profile.transports.includes('pty')) issues.push('a pty ceiling stands over a policy offering no pty');
  if (ceilings.openFiles !== 'absent' && ceilings.executions > ceilings.openFiles) {
    issues.push(`admitting ${ceilings.executions} executions requires more handles than the ${ceilings.openFiles} left`);
  }
  if (ceilings.processes !== 'absent' && ceilings.executions > ceilings.processes)
    issues.push(`admitting ${ceilings.executions} executions costs more processes than the ${ceilings.processes} left`);
  if (ceilings.readers < profile.execution.read.readers) issues.push('execution readers exceed the host reader ceiling');
  if (ceilings.reads < profile.execution.read.readers) issues.push('execution concurrent reads exceed the host read ceiling');
  if (ceilings.receipts < profile.execution.receipts) issues.push('execution receipts exceed the host receipt ceiling');
  const held = BigInt(ceilings.executions) * BigInt(reserve);
  if (held > SAFE) {
    issues.push(`admitting ${ceilings.executions} executions would reserve ${held} bytes, past exact integer arithmetic`);
  }
  return issues.length === 0 ? undefined : issues.join('; ');
});

export const CapabilityProfile = profileFields.check(policySizing, profileSizing);
export type CapabilityProfile = typeof CapabilityProfile.Type;
