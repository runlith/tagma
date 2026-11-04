import { constants } from 'node:os';
import { NativeUsage, type UsagePlatform } from '../UsageAbi';
import type { SamplingPlatform } from '../Sampler';
import { programsOf } from './programs';
import { psUsage } from './ps';

const platform: UsagePlatform = {
  code: 1,
  adapter: 'darwin',
  memoryProbe: 'host_statistics64:HOST_VM_INFO64 + hw.memsize',
  pressureProbe: 'kern.memorystatus_vm_pressure_level',
  startedAt: (seconds, micros) => Number(seconds) * 1000 + Number(micros) / 1000,
  gpuUnavailable: (errno) =>
    errno === constants.errno.ENOTSUP
      ? 'no AGX AppUsage GPU counters are visible in this registry read'
      : `the IOKit GPU registry read answered errno ${errno}`,
  clientUnavailable: (errno) => `the AGX client's GPU counter answered errno ${errno}`,
};

export const sampling: SamplingPlatform = {
  machineName: 'Mac',
  programs: programsOf,
  refused: psUsage,
  gpuMissing: 'the process has no visible AGX GPU client',
};

export const nativeUsage = (path: string) => NativeUsage.load(path, platform);
