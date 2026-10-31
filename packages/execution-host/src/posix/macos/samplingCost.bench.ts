import { dlopen, FFIType, ptr } from 'bun:ffi';
import { resolve } from 'node:path';
import { Abi } from './ProcessAbi';
import { Sampler } from './Sampler';
import { NativeUsage } from './UsageAbi';
import { psUsage, type RefusedUsage } from './ps';

const library = resolve(import.meta.dir, '../../../native/target/release/libexecution_platform.dylib');
const processReader = Abi.load(library);
const counters = NativeUsage.load(library);
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
  const sampler = new Sampler(counters, processReader, refused);
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

try {
  console.log(JSON.stringify({ closed: measure(false), open: measure(true) }));
} finally {
  counters.unload();
  processReader.unload();
  system.close();
}
