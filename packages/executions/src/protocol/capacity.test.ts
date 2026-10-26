import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import { CapabilityProfile, type MachineReading, ceilingsOf, maximumCeilingsOf, countLimits, grantOf, reserveOf } from './capacity';

const policy = {
  transports: ['pipes', 'pty'],
  relations: ['leader', 'work'],
  execution: {
    input: { pendingBytes: 16384, chunkBytes: 16384, receipts: 32 },
    output: { landingBytes: 65536, segmentBytes: 65536, retainedBytes: 1048576 },
    parser: { pendingBytes: 4096, cellBytes: 1048576 },
    geometry: { columns: 500, rows: 200, scrollbackRows: 10000 },
    read: { chunkBytes: 65536, readerCredits: 4, readers: 8 },
    frame: { bytes: 262144, inFlight: 2 },
    receipts: 64,
  },
  host: { bindings: 64, custodyReceipts: 64, tombstones: 1024 },
} as const;

const HOLDER_COST = 4;
const LOGIC_COST = 4;
const RESERVE = reserveOf(policy.execution, 'pty');
const MACHINE = 4 * 64 * RESERVE;
const granted = grantOf(0.25, MACHINE);
const machine = {
  granted,
  descriptors: { pipes: { holder: HOLDER_COST, logic: LOGIC_COST }, pty: { holder: HOLDER_COST, logic: LOGIC_COST } },
  limits: { openFiles: 64 * LOGIC_COST + 40, holderFiles: 64 * HOLDER_COST + 40, processes: 100, terminals: 96 },
  standing: { descriptors: 40, holderDescriptors: 40, processes: 36, terminals: 32 },
} satisfies MachineReading;

const profile = {
  version: 1,
  platform: { os: 'darwin', arch: 'arm64' },
  runtime: { name: 'bun', version: '1.4.2' },
  native: { crate: 'execution-platform', version: '0.1.0', build: 'local' },
  ...policy,
  granted,
  ceilings: {
    executions: 64,
    terminals: 32,
    readers: 512,
    reads: 512,
    receipts: 4096,
    openFiles: 64 * LOGIC_COST,
    processes: 64,
    perTransport: { pipes: 64, pty: 64 },
  },
} as const;

const decode = Schema.decodeUnknownResult(CapabilityProfile);

describe('a capability profile agrees with itself', () => {
  test('a coherent profile decodes', () => {
    expect(decode(profile)._tag).toBe('Success');
  });

  test('the reserve is the live terminal and never its history', () => {
    const geometry = policy.execution.geometry;
    expect(reserveOf({ ...policy.execution, geometry: { ...geometry, scrollbackRows: geometry.scrollbackRows * 10 } }, 'pty')).toBe(
      RESERVE,
    );
    expect(reserveOf({ ...policy.execution, geometry: { ...geometry, rows: geometry.rows + 1 } }, 'pty')).toBeGreaterThan(RESERVE);
    expect(reserveOf(policy.execution, 'pipes')).toBeLessThan(RESERVE);
  });

  test('the ceilings a machine derives stand on its platform limits, less what stands on it', () => {
    const derived = { ...profile, ceilings: ceilingsOf(policy, machine) };
    expect(decode(derived)._tag).toBe('Success');
    expect(derived.ceilings.terminals).toBe(machine.limits.terminals - machine.standing.terminals);
    expect(derived.ceilings.executions).toBe(64);
    expect(derived.ceilings.openFiles).toBe(machine.limits.openFiles - machine.standing.descriptors);
    expect(derived.ceilings.processes).toBe(machine.limits.processes - machine.standing.processes);
  });

  test('kernel limits bound bootstrap capacity before current occupancy narrows admission', () => {
    const limits = { granted: machine.granted, descriptors: machine.descriptors, limits: machine.limits };
    const maximum = maximumCeilingsOf(policy, limits);
    const crowded = { ...machine, standing: { ...machine.standing, processes: 96 } };
    expect(maximum.executions).toBe(64);
    expect(maximum.openFiles).toBe(machine.limits.openFiles);
    expect(maximum.processes).toBe(machine.limits.processes);
    expect(ceilingsOf(policy, crowded).executions).toBe(4);
    expect(Schema.decodeUnknownResult(CapabilityProfile)({ ...profile, ceilings: maximum })._tag).toBe('Success');
  });

  test('the count is the least platform limit, and the term that bound it is named', () => {
    const crowded = { ...machine, standing: { ...machine.standing, processes: 96 } };
    expect(ceilingsOf(policy, crowded).executions).toBe(4);
    const least = countLimits(policy, crowded).reduce((held, term) => (term.count < held.count ? term : held));
    expect(least.limit).toBe('processes');
  });

  test('holder and logic handles bound admission independently at their own execution expenses', () => {
    const reading: MachineReading = {
      ...machine,
      descriptors: { pipes: { holder: 4, logic: 4 }, pty: { holder: 4, logic: 8 } },
      limits: { ...machine.limits, holderFiles: 32, openFiles: 32 },
      standing: { ...machine.standing, holderDescriptors: 8, descriptors: 16 },
    };
    expect(
      countLimits(policy, reading)
        .filter((term) => term.limit.endsWith('descriptors'))
        .map((term) => [term.limit, term.transport, term.count]),
    ).toEqual([
      ['holder-descriptors', 'pipes', 6],
      ['holder-descriptors', 'pty', 6],
      ['logic-descriptors', 'pipes', 4],
      ['logic-descriptors', 'pty', 2],
    ]);
    expect(ceilingsOf(policy, reading).perTransport).toEqual({ pipes: 4, pty: 2 });
    expect(ceilingsOf(policy, reading).executions).toBe(2);
    const freedLogic = { ...reading, limits: { ...reading.limits, openFiles: 64 } };
    expect(ceilingsOf(policy, freedLogic).executions).toBe(6);
    expect(ceilingsOf(policy, { ...freedLogic, standing: { ...freedLogic.standing, holderDescriptors: 24 } }).executions).toBe(2);
  });

  test('the terminals standing on a machine bound its terminals and never its other executions', () => {
    const taken = { ...machine, standing: { ...machine.standing, terminals: machine.limits.terminals } };
    const pipes = { ...policy, transports: ['pipes'] } as const;
    expect(ceilingsOf(policy, taken).executions).toBe(64);
    expect(ceilingsOf(policy, taken).terminals).toBe(0);
    expect(countLimits(policy, taken).find((term) => term.limit === 'terminals')?.count).toBe(0);
    expect(ceilingsOf(pipes, taken).executions).toBe(64);
    expect(ceilingsOf(pipes, taken).terminals).toBe(0);
    expect(countLimits(pipes, taken).some((term) => term.limit === 'terminals')).toBe(false);
  });

  test('absent platform limits leave admission bounded by the granted memory', () => {
    const unbounded: MachineReading = {
      ...machine,
      granted: grantOf(0.25, 4 * 3 * RESERVE),
      limits: { openFiles: 'absent', holderFiles: 'absent', processes: 'absent', terminals: 'absent' },
    };
    const terminals = { ...policy, transports: ['pty'] } as const;
    const ceilings = ceilingsOf(terminals, unbounded);
    expect(ceilings.executions).toBe(3);
    expect(ceilings.terminals).toBe(3);
    expect(ceilings.openFiles).toBe('absent');
    expect(ceilings.processes).toBe('absent');
    expect(decode({ ...profile, ...terminals, granted: unbounded.granted, ceilings })._tag).toBe('Success');
    expect(ceilingsOf(policy, unbounded).perTransport.pipes).toBeGreaterThan(ceilings.perTransport.pty);
  });

  test('a present process limit still bounds admission when other platform limits are absent', () => {
    const partial: MachineReading = {
      ...machine,
      limits: { openFiles: 'absent', holderFiles: 'absent', processes: 38, terminals: 'absent' },
    };
    expect(countLimits(policy, partial).map((term) => [term.limit, term.count])).toEqual([['processes', 2]]);
    expect(ceilingsOf(policy, partial).executions).toBe(2);
    expect(ceilingsOf(policy, partial).terminals).toBe(2);
    expect(ceilingsOf({ ...policy, transports: ['pipes'] }, partial).terminals).toBe(0);
  });

  test('a count above the descriptors its own machine left is refused', () => {
    const derived = ceilingsOf(policy, machine);
    const overcommitted = { ...profile, ceilings: { ...derived, openFiles: derived.executions - 1 } };
    expect(decode(overcommitted)._tag).toBe('Failure');
    expect(decode({ ...profile, ceilings: { ...derived, processes: derived.executions - 1 } })._tag).toBe('Failure');
  });

  test('a chunk larger than the queue it enters is refused', () => {
    const wideChunk = {
      ...profile,
      execution: { ...profile.execution, input: { ...profile.execution.input, pendingBytes: 1024, chunkBytes: 4096 } },
    };
    expect(decode(wideChunk)._tag).toBe('Failure');
  });

  test('a retention budget without room for a segment and the next landing chunk is refused', () => {
    expect(
      decode({
        ...profile,
        execution: {
          ...profile.execution,
          output: { ...profile.execution.output, retainedBytes: profile.execution.output.segmentBytes },
        },
      })._tag,
    ).toBe('Failure');
  });

  test('more terminals than executions is refused', () => {
    expect(decode({ ...profile, ceilings: { ...profile.ceilings, terminals: 65 } })._tag).toBe('Failure');
  });

  test('a grant that cannot hold one execution is refused', () => {
    const starved = { ...profile, granted: grantOf(0.25, RESERVE), ceilings: { ...profile.ceilings, executions: 1, terminals: 1 } };
    expect(decode(starved)._tag).toBe('Failure');
  });

  test('a grant larger than the machine it was read from is refused', () => {
    const impossible = { ...profile, granted: { ...granted, grantBytes: MACHINE + 1 } };
    expect(decode(impossible)._tag).toBe('Failure');
  });

  test('a profile whose admitted reserves leave exact integer arithmetic is refused', () => {
    const executions = Math.ceil(Number.MAX_SAFE_INTEGER / RESERVE);
    const machine = 4 * executions * RESERVE;
    const huge = {
      ...profile,
      granted: grantOf(0.25, machine),
      ceilings: { ...profile.ceilings, executions, terminals: executions },
    };
    expect(decode(huge)._tag).toBe('Failure');
  });
});
