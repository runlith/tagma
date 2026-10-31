import { expect, test } from 'bun:test';
import { it } from '@runlith/effect-test';
import { Effect } from 'effect';
import { constants } from 'node:os';
import type { ProcessIdentity, ProcessReading, ProcessRow } from '../../ProcessReader';
import type { LoadedLibrary } from '../Library';
import type { ProcessAbi } from './ProcessAbi';
import type { NativeCounters, UsageAbi } from './UsageAbi';
import { Sampler } from './Sampler';
import { processReader } from './processes';
import type { RefusedUsage } from './ps';
import type { GpuRead } from './gpu';

const unused = (): never => {
  throw new Error('unexpected native operation');
};

const native = (): ProcessAbi => ({
  unload: unused,
  identity: unused,
  uptimeNanos: unused,
  limits: unused,
  descriptors: unused,
  processTable: unused,
  processFacts: unused,
  processIdentity: unused,
});

it.effect('a declared process resolves only to a matching, readable kernel witness', () =>
  Effect.gen(function* () {
    let identity: ProcessIdentity = { _tag: 'Read', pid: 21, birth: '1000:500001', parent: 1, work: 21, zombie: false };
    const library: LoadedLibrary = {
      path: '',
      build: { crate: '', version: '', target: '', profile: '', rustc: '', source: '', closure: [], digest: '' },
      abi: { ...native(), processIdentity: () => identity },
    };
    const reader = yield* processReader(library);
    const part = { key: 'renderer', pid: 21, createdMs: 1_000_500, precisionMs: 0.002 };
    expect(reader.resolve(part)).toEqual({ pid: 21, birth: '1000:500001' });
    expect(reader.resolve({ ...part, precisionMs: 0 })).toBe('different');
    identity = { ...identity, birth: '1001:0' };
    expect(reader.resolve(part)).toBe('different');
    identity = { ...identity, birth: 'unrecognized' };
    expect(reader.resolve(part)).toBe('unknown');
    identity = { ...identity, pid: 22, birth: '1000:500001' };
    expect(reader.resolve(part)).toBe('unknown');
    identity = { _tag: 'Gone' };
    expect(reader.resolve(part)).toBe('unknown');
    identity = { _tag: 'Unreadable', detail: 'denied' };
    expect(reader.resolve(part)).toBe('unknown');
  }),
);

const counter = (pid: number, parent: number, responsible: number, errno = 0): NativeCounters => ({
  pid,
  errno,
  parent,
  work: pid,
  birth: `1000:${pid}`,
  startedAtMs: 1_000_000,
  zombie: false,
  cpuMicros: 100,
  childMicros: 20,
  residentBytes: 1000,
  footprintBytes: 800,
  memoryErrno: 0,
  responsible,
});

test('usage reads refused processes only on demand and discards a replaced pid', () => {
  const denied = constants.errno.EPERM;
  const counters = [
    counter(10, 1, 10),
    { ...counter(20, 10, 20), footprintBytes: undefined },
    counter(30, 1, 10, denied),
    counter(40, 1, 10, denied),
  ];
  const usage: UsageAbi = {
    unload: unused,
    all: () => counters,
    machine: () => ({ errno: 1 }),
    gpu: () => ({ _tag: 'Unavailable', reason: 'not measured' }),
  };
  const facts = (pids: ReadonlyArray<number>): ProcessReading => ({
    processes: pids.map((pid) => ({
      pid,
      parent: pid === 20 ? 10 : 1,
      work: pid,
      birth: `1000:${pid}`,
      args: { _tag: 'Read', value: [pid === 10 ? '/Applications/Editor.app/Contents/MacOS/Editor' : '/bin/helper'] },
      executable: { _tag: 'Read', value: pid === 10 ? '/Applications/Editor.app/Contents/MacOS/Editor' : '/bin/helper' },
      folder: { _tag: 'Unreadable', detail: 'denied' },
    })),
    unread: [],
  });
  const after: ProcessRow[] = [
    { pid: 30, parent: 1, work: 30, birth: '1000:30', zombie: false },
    { pid: 40, parent: 1, work: 40, birth: '1001:40', zombie: false },
  ];
  const processes: ProcessAbi = { ...native(), processFacts: facts, processTable: () => after };
  let demand = false;
  const refused: RefusedUsage = {
    read: (pids) => {
      if (!demand || pids.join(',') !== '30,40') throw new Error('refused counters must be read in one demanded batch');
      return {
        read: new Map([
          [30, { micros: 500, residentBytes: 50 }],
          [40, { micros: 600, residentBytes: 60 }],
        ]),
      };
    },
  };
  const sampler = new Sampler(usage, processes, refused);
  const closed = sampler.read({ others: false });
  if (typeof closed === 'string') throw new Error(closed);
  expect(sampler.machineName).toBe('Mac');
  expect(closed.processes.find((row) => row.pid === 10)).toMatchObject({
    cpu: { micros: 120, reapedMicros: 20 },
    memoryKind: 'footprint',
  });
  expect(closed.processes.find((row) => row.pid === 20)).toMatchObject({
    program: { key: '/Applications/Editor.app' },
    memoryKind: 'resident',
  });
  expect(closed.processes.find((row) => row.pid === 30)).toMatchObject({ cpu: undefined, onBehalfOf: undefined, name: 'process 30' });
  expect(closed.processes.find((row) => row.pid === 10)?.gpu).toMatchObject({ _tag: 'Unavailable' });
  demand = true;
  const open = sampler.read({ others: true });
  if (typeof open === 'string') throw new Error(open);
  expect(open.processes.find((row) => row.pid === 30)).toMatchObject({
    cpu: { micros: 500, reapedMicros: undefined },
    memoryKind: 'resident',
    onBehalfOf: 10,
    program: { key: '/Applications/Editor.app' },
  });
  expect(open.processes.find((row) => row.pid === 40)).toMatchObject({ cpu: undefined, onBehalfOf: undefined });
  expect(open.processes.find((row) => row.pid === 40)?.memoryKind).toBeUndefined();
});

test('GPU client resets and departures preserve cumulative usage without crossing kernel witnesses', () => {
  let row = counter(10, 1, 10);
  let read: GpuRead = { _tag: 'Read', clients: [] };
  const usage: UsageAbi = { unload: unused, all: () => [row], machine: () => ({ errno: 1 }), gpu: () => read };
  const processes: ProcessAbi = { ...native(), processFacts: () => ({ processes: [], unread: [] }) };
  const sampler = new Sampler(usage, processes, { read: unused });
  const sample = () => {
    const result = sampler.read({ others: false });
    if (typeof result === 'string') throw new Error(result);
    return result.processes[0]!.gpu;
  };
  const clients = (a: number, b?: number, birth = '1000:10'): GpuRead => ({
    _tag: 'Read',
    clients: [
      { pid: 10, birth, client: 'a', gpu: { _tag: 'Measured', micros: a } },
      ...(b === undefined ? [] : [{ pid: 10, birth, client: 'b', gpu: { _tag: 'Measured' as const, micros: b } }]),
    ],
  });
  expect(sample()._tag).toBe('Unavailable');
  read = clients(0);
  expect(sample()).toEqual({ _tag: 'Measured', micros: 0 });
  read = clients(100, 900);
  expect(sample()).toEqual({ _tag: 'Measured', micros: 1000 });
  read = clients(110);
  expect(sample()).toEqual({ _tag: 'Measured', micros: 1010 });
  read = clients(5);
  expect(sample()).toEqual({ _tag: 'Measured', micros: 1010 });
  read = clients(15);
  expect(sample()).toEqual({ _tag: 'Measured', micros: 1020 });
  read = clients(20, undefined, '1001:10');
  expect(sample()._tag).toBe('Unavailable');
  row = { ...row, birth: '1001:10' };
  expect(sample()).toEqual({ _tag: 'Measured', micros: 20 });
  read = { _tag: 'Unavailable', reason: 'the registry denied this read' };
  expect(sample()).toEqual(read);
});
