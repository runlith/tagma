import { dlopen, FFIType, ptr } from 'bun:ffi';
import { resolve } from 'node:path';
import { arch, cpus, loadavg, platform, totalmem } from 'node:os';
import { Abi } from '../ProcessAbi';
import { Sampler, type RefusedUsage } from '../Sampler';
import { nativeUsage, sampling } from './sampling';
import { psUsage } from './ps';

const library = resolve(import.meta.dir, '../../../native/target/release/libexecution_platform.dylib');
const processReader = Abi.load(library);
const counters = nativeUsage(library);
const system = dlopen('/usr/lib/libSystem.B.dylib', {
  getrusage: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
});

const cpu = (who: number): number => {
  const buffer = new Uint8Array(256);
  if (system.symbols.getrusage(who, ptr(buffer)) !== 0) throw new Error(`getrusage(${who}) failed`);
  const view = new DataView(buffer.buffer);
  return (
    Number(view.getBigInt64(0, true)) * 1_000_000 +
    view.getInt32(8, true) +
    Number(view.getBigInt64(16, true)) * 1_000_000 +
    view.getInt32(24, true)
  );
};

const measure = (others: boolean) => {
  let calls = 0;
  const refused: RefusedUsage = {
    read: (pids) => {
      if (pids.length > 0) calls += 1;
      return psUsage.read(pids);
    },
  };
  const sampler = new Sampler(counters, processReader, { ...sampling, refused });
  const warm = sampler.read({ others });
  if (typeof warm === 'string') throw new Error(warm);
  calls = 0;
  const rounds = 10;
  const beforeCpu = cpu(0) + cpu(-1);
  const beforeWall = performance.now();
  let processes = 0;
  for (let at = 0; at < rounds; at += 1) {
    const read = sampler.read({ others });
    if (typeof read === 'string') throw new Error(read);
    processes = read.processes.length;
  }
  const wallMs = (performance.now() - beforeWall) / rounds;
  const cpuMs = (cpu(0) + cpu(-1) - beforeCpu) / 1000 / rounds;
  return { others, processes, rounds, wallMs, cpuMs, childProcessesPerPass: calls / rounds };
};

const measureGpu = () => {
  const system = counters.all();
  if (!Array.isArray(system)) throw new Error('the native process population could not be read');
  const rounds = 10;
  const warm = counters.gpu();
  if (warm._tag === 'Unavailable') return warm;
  const beforeCpu = cpu(0) + cpu(-1);
  const beforeWall = performance.now();
  let clients = 0;
  let measuredProcesses = 0;
  for (let at = 0; at < rounds; at += 1) {
    const read = counters.gpu();
    if (read._tag === 'Unavailable') return read;
    clients = read.clients.length;
    measuredProcesses = new Set(read.clients.filter((client) => client.gpu._tag === 'Measured').map((client) => client.pid)).size;
  }
  return {
    processes: system.length,
    clients,
    measuredProcesses,
    rounds,
    wallMs: (performance.now() - beforeWall) / rounds,
    cpuMs: (cpu(0) + cpu(-1) - beforeCpu) / 1000 / rounds,
    childProcessesPerPass: 0,
  };
};

try {
  console.log(
    JSON.stringify({
      machine: { platform: platform(), arch: arch(), cores: cpus().length, memoryBytes: totalmem(), load: loadavg() },
      closed: measure(false),
      open: measure(true),
      gpu: measureGpu(),
    }),
  );
} finally {
  counters.unload();
  processReader.unload();
  system.close();
}
