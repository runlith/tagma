import { constants } from 'node:os';
import { NativeUsage, type UsagePlatform } from '../UsageAbi';
import type { SamplingPlatform } from '../Sampler';
import { programsOf } from '../programs';
import { BirthClock } from './clock';

const unavailable = 'no portable Linux per-process GPU counter is available';

export const sampling: SamplingPlatform = {
  machineName: 'Linux',
  programs: programsOf,
  refused: { read: () => ({ read: new Map(), detail: 'the kernel did not permit these process counters to be read' }) },
  gpuMissing: unavailable,
};

export const nativeUsage = (path: string): NativeUsage => {
  const clock = BirthClock.load(path);
  const platform: UsagePlatform = {
    code: 2,
    adapter: 'linux',
    memoryProbe: '/proc/meminfo:MemTotal + MemAvailable',
    pressureProbe: '/proc/pressure/memory',
    startedAt: (first, second) => clock.startedAt(first, second),
    gpuUnavailable: (errno) => (errno === constants.errno.ENOTSUP ? unavailable : `the GPU counter read answered errno ${errno}`),
    clientUnavailable: (errno) => `the GPU client counter answered errno ${errno}`,
  };
  return NativeUsage.load(path, platform);
};
