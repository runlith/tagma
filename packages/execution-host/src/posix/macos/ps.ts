import type { RefusedCounter, RefusedUsage } from '../Sampler';

const clock = (text: string): number | undefined => {
  const [days, rest] = text.includes('-') ? (text.split('-') as [string, string]) : ['0', text];
  const parts = rest.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  const seconds = parts.reduce((sum, part) => sum * 60 + part, 0) + Number(days) * 86_400;
  return Number.isFinite(seconds) ? Math.round(seconds * 1_000_000) : undefined;
};

export const psUsage: RefusedUsage = {
  read: (pids) => {
    if (pids.length === 0) return { read: new Map() };
    const ran = Bun.spawnSync(['/bin/ps', '-o', 'pid=,cputime=,rss=', '-p', pids.join(',')], { stdout: 'pipe', stderr: 'pipe' });
    const read = new Map<number, RefusedCounter>();
    for (const line of new TextDecoder().decode(ran.stdout).split('\n')) {
      const [pid, time, rss] = line.trim().split(/\s+/);
      const micros = time === undefined ? undefined : clock(time);
      if (pid === undefined || micros === undefined || rss === undefined) continue;
      read.set(Number(pid), { micros, residentBytes: Number(rss) * 1024 });
    }
    return read.size === 0 && ran.exitCode !== 0 ? { read, detail: `/bin/ps exited ${ran.exitCode}` } : { read };
  },
};
