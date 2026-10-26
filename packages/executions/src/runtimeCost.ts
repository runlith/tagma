import type { ProcessCost } from './protocol/execution';

type Reaped = {
  readonly resourceUsage: () =>
    | { readonly cpuTime: { readonly user: number | bigint; readonly system: number | bigint }; readonly maxRSS: number }
    | undefined;
};

export const runtimeCost = (child: Reaped): ProcessCost => {
  try {
    const usage = child.resourceUsage();
    const cpu = usage?.cpuTime;
    if (usage === undefined || cpu === undefined) {
      return { _tag: 'Unmeasured', reason: 'unsupported', detail: 'this runtime answered no resource usage for the reaped child' };
    }
    return { _tag: 'Measured', cpuMicros: Number(cpu.user) + Number(cpu.system), peakRssBytes: usage.maxRSS };
  } catch (cause) {
    return { _tag: 'Unmeasured', reason: 'failed', detail: String(cause) };
  }
};
