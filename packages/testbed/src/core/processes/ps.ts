import { createRequire } from 'node:module';
import { pristine } from '../pristine.ts';
import { MARK, marksIn, type Facts, type Processes, type Row } from '../processes.ts';

const MARKED = new RegExp(`(?:^|\\s)${MARK}=(\\S+)`);
const LISTING = /^\s*\d+\s+\d+\s+\d+\s+\S+\s+\/bin\/ps /;

type ChildProcess = typeof import('node:child_process');

const elapsed = (text: string): number => {
  const [days, clock] = text.includes('-') ? (text.split('-') as [string, string]) : ['0', text];
  return clock
    .split(':')
    .map(Number)
    .reduce((total, part) => total * 60 + part, Number(days) * 86_400);
};

export const ps = (): Processes => {
  const run = pristine((createRequire(import.meta.url)('node:child_process') as ChildProcess).execFileSync);
  const listed = (command: string, args: readonly string[]): string => {
    try {
      return run(command, args, { env: {}, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      return String((error as { stdout?: unknown }).stdout ?? '');
    }
  };
  const parse = (line: string): Row | undefined => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s(.*)$/.exec(line);
    if (match === null || LISTING.test(line)) return undefined;
    return {
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      zombie: match[4]!.startsWith('Z'),
      start: Math.floor(Date.now() / 1000) - elapsed(match[5]!),
      name: '',
      marks: marksIn(MARKED.exec(match[6]!)?.[1]),
    };
  };
  const described = (pids: readonly number[]): Row[] =>
    pids.length === 0
      ? []
      : listed('/bin/ps', ['-E', '-ww', '-o', 'pid=,ppid=,pgid=,stat=,etime=,command=', '-p', pids.join(',')])
          .split('\n')
          .flatMap((line) => parse(line) ?? []);
  const members = (groups: readonly number[]): number[] =>
    groups.length === 0
      ? []
      : listed('/usr/bin/pgrep', ['-g', groups.join(',')])
          .split('\n')
          .filter((line) => line !== '')
          .map(Number);
  return {
    facts: (pid) => described([pid])[0],
    rows: (scope) =>
      scope === 'all'
        ? listed('/bin/ps', ['-E', '-ww', '-Ao', 'pid=,ppid=,pgid=,stat=,etime=,command='])
            .split('\n')
            .flatMap((line) => parse(line) ?? [])
        : described(members(scope)),
    clock: () => Date.now() / 1000,
    born: (since) => {
      const now = Math.floor(Date.now() / 1000);
      const young = listed('/bin/ps', ['-Ao', 'pid=,ppid=,etime='])
        .split('\n')
        .flatMap((line) => {
          const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
          return match !== null && match[2] === '1' && now - elapsed(match[3]!) >= Math.floor(since) ? [Number(match[1])] : [];
        });
      return described(young);
    },
    children: (pid) =>
      listed('/usr/bin/pgrep', ['-P', String(pid)])
        .split('\n')
        .filter((line) => line !== '')
        .map(Number),
    cwds: (pids) => {
      const found = new Map<number, string>();
      if (pids.length === 0) return found;
      let pid = 0;
      for (const line of listed('/usr/sbin/lsof', ['-w', '-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn']).split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1));
        else if (line.startsWith('n')) found.set(pid, line.slice(1));
      }
      return found;
    },
    command: (pid) => listed('/bin/ps', ['-ww', '-o', 'command=', '-p', String(pid)]).trim() || undefined,
    cpu: () => undefined,
    reaped: () => undefined,
  };
};
