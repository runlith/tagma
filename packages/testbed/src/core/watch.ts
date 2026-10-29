import { createRequire } from 'node:module';
import { relative } from 'node:path';
import { commandOf, kindOfCommand, makeChildren, type ByKind, type Child, type ChildKind } from './children.ts';
import { pristine } from './pristine.ts';
import type { Facts, Processes, Row } from './processes.ts';

const GRACE_MS = 8_000;
const POLL_MS = 50;
const REAPER =
  'set -f; list=" "; while read -r op p; do case "$op" in +) list="$list$p " ;; -) case "$list" in *" $p "*) list="${list%% $p *} ${list#* $p }" ;; esac ;; esac; done; [ "$list" = " " ] || kill -9 -- $list 2>/dev/null; exit 0';

type ChildProcess = typeof import('node:child_process');

type Exiting = {
  readonly pid?: number | undefined;
  readonly exited?: Promise<unknown>;
  readonly once?: (event: 'exit', listener: () => void) => unknown;
};

export type Hold = { readonly group?: boolean };

export type Residue = { readonly count: number; readonly message: string };

export type WatchOptions = {
  readonly processes: () => Processes | undefined;
  readonly file: () => string;
  readonly author: () => string;
  readonly site: (stack: string | undefined) => string | undefined;
  readonly cwd: string;
};

const ms = (micros: number | bigint | undefined): number | undefined => (micros === undefined ? undefined : Number(micros) / 1000);

type Usage = { resourceUsage?: () => { cpuTime?: { total?: bigint } } | undefined };

const handleOf = (child: object): Usage | undefined => {
  for (let at: object | null = child; at !== null; at = Object.getPrototypeOf(at)) {
    const key = Object.getOwnPropertySymbols(at).find((symbol) => symbol.description === 'kHandle');
    if (key !== undefined) return (child as Record<symbol, Usage | undefined>)[key];
  }
  return undefined;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const kill = (pid: number): void => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
};

const within = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

export const ownerOf = (mark: string): number => Number(mark.slice(0, mark.indexOf('.')));

export const makeWatch = (options: WatchOptions) => {
  const children = makeChildren(options.processes);
  const held = new Map<number, Hold>();
  const internal = new Set<number>();
  let spawned: Child[] = [];
  let since: number | undefined;
  let reaper: { readonly pid: number; readonly write: (line: string) => void } | undefined;
  let holding = 0;
  const homes = new Map<string, number>();
  const claimed = new Map<number, number>();

  const target = (pid: number, hold: Hold): string => (hold.group === true ? `-${pid}` : String(pid));

  const gone = (pid: number): void => {
    internal.delete(pid);
    if (reaper?.pid === pid) reaper = undefined;
  };

  const lost = (pid: number): void => {
    const current = reaper?.pid === pid;
    gone(pid);
    if (current && held.size > 0) openReaper();
  };

  const spawnReaper = (): { readonly pid: number; readonly write: (line: string) => void } => {
    if (typeof Bun !== 'undefined') {
      const proc = pristine(Bun.spawn)(['/bin/sh', '-c', REAPER], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore', env: {} });
      proc.unref();
      (proc.stdin as { unref?: () => void }).unref?.();
      internal.add(proc.pid);
      proc.exited.then(() => lost(proc.pid));
      return {
        pid: proc.pid,
        write: (line) => {
          proc.stdin.write(line);
          proc.stdin.flush();
        },
      };
    }
    const spawn = pristine((createRequire(import.meta.url)('node:child_process') as ChildProcess).spawn);
    const child = spawn('/bin/sh', ['-c', REAPER], { stdio: ['pipe', 'ignore', 'ignore'], env: {} });
    child.unref();
    (child.stdin as unknown as { unref?: () => void }).unref?.();
    const pid = child.pid ?? -1;
    internal.add(pid);
    child.once('exit', () => lost(pid));
    child.stdin?.on('error', () => lost(pid));
    return { pid, write: (line) => child.stdin?.write(line) };
  };

  const openReaper = (): void => {
    const opened = spawnReaper();
    reaper = opened;
    const lines = [...held].map(([pid, hold]) => `+ ${target(pid, hold)}\n`).join('');
    if (lines !== '') opened.write(lines);
  };

  const tell = (line: string): void => {
    if (reaper === undefined) {
      openReaper();
      return;
    }
    try {
      reaper.write(line);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
      gone(reaper.pid);
      openReaper();
    }
  };

  const release = (pid: number): void => {
    const hold = held.get(pid);
    if (hold === undefined) return;
    held.delete(pid);
    if (reaper !== undefined) tell(`- ${target(pid, hold)}\n`);
  };

  const holdProcess = (child: Exiting | number, hold: Hold = {}): void => {
    const pid = typeof child === 'number' ? child : child.pid;
    if (pid === undefined || held.has(pid)) return;
    held.set(pid, hold);
    tell(`+ ${target(pid, hold)}\n`);
    if (typeof child === 'number') return;
    if (child.exited instanceof Promise)
      child.exited.then(
        () => release(pid),
        () => release(pid),
      );
    else if (typeof child.once === 'function') child.once('exit', () => release(pid));
  };

  const record = (via: string, args: readonly unknown[], result: unknown, sync: boolean, cpu: number | undefined): void => {
    const kind: ChildKind = kindOfCommand(commandOf(via, args));
    const pid = typeof (result as { pid?: unknown } | null)?.pid === 'number' ? (result as { pid: number }).pid : undefined;
    const done = sync || pid === undefined;
    const file = options.author();
    const child: Child = {
      pid: done ? undefined : pid,
      kind,
      file,
      site: options.site(new Error().stack),
      cpu: cpu ?? 0,
      final: done,
      measured: cpu !== undefined,
    };
    spawned.push(child);
    children.add(child);
    if (done) return;
    if (holding > 0 || file !== options.file()) holdProcess(result as Exiting);
    const exiting = result as Exiting & { resourceUsage?: () => { cpuTime?: { total?: bigint } } | undefined };
    if (exiting.exited instanceof Promise) {
      const done = () => children.finish(child, ms(exiting.resourceUsage?.()?.cpuTime?.total));
      exiting.exited.then(done, done);
    } else if (typeof exiting.once === 'function') {
      const handle = handleOf(exiting as object);
      exiting.once('exit', () => children.finish(child, ms(handle?.resourceUsage?.()?.cpuTime?.total)));
    }
  };

  const reapedSince = (reaped: number | undefined, known: number): number | undefined => {
    const now = options.processes()?.reaped();
    return reaped === undefined || now === undefined ? undefined : Math.max(0, now - reaped - (children.known() - known));
  };

  const shell = <T>(result: T): T => {
    const child: Child = {
      pid: undefined,
      kind: 'other',
      file: options.author(),
      site: options.site(new Error().stack),
      cpu: 0,
      final: false,
      measured: false,
    };
    spawned.push(child);
    children.add(child);
    const reaped = options.processes()?.reaped();
    const known = children.known();
    const promise = result as { then?: (ok?: (value: unknown) => unknown, fail?: (error: unknown) => unknown) => unknown };
    const then = promise.then;
    if (typeof then !== 'function') return result;
    const settle = (): void => {
      if (!child.final) children.finish(child, reapedSince(reaped, known));
    };
    promise.then = (ok, fail) =>
      then.call(
        result,
        (value: unknown) => {
          settle();
          return ok === undefined ? value : ok(value);
        },
        (error: unknown) => {
          settle();
          if (fail === undefined) throw error;
          return fail(error);
        },
      );
    return result;
  };

  const process_ = <T>(via: string, args: readonly unknown[], sync: boolean, run: () => T): T => {
    const reaped = sync ? options.processes()?.reaped() : undefined;
    const known = children.known();
    const result = run();
    if (via === '$') return shell(result);
    const usage = (result as { resourceUsage?: { cpuTime?: { total?: bigint } } } | null)?.resourceUsage;
    record(via, args, result, sync, sync ? (ms(usage?.cpuTime?.total) ?? reapedSince(reaped, known)) : undefined);
    return result;
  };

  const unclaimGone = (processes: Processes): void => {
    for (const [pid, start] of claimed) {
      const facts = processes.facts(pid);
      if (facts !== undefined && !facts.zombie && facts.start === start) continue;
      claimed.delete(pid);
      release(pid);
    }
  };

  const claimedBy = (processes: Processes, rows: readonly Row[]): Set<number> => {
    const owned = new Set<number>();
    if (homes.size === 0) return owned;
    for (const row of rows) {
      const command = processes.command(row.pid);
      if (command === undefined || ![...homes.keys()].some((home) => command.includes(home))) continue;
      owned.add(row.pid);
      if (claimed.has(row.pid)) continue;
      claimed.set(row.pid, row.start);
      holdProcess(row.pid);
    }
    return owned;
  };

  const suspects = (processes: Processes, token: string, root: string, mine: ReadonlySet<number>): Row[] => {
    const byPid = new Map(processes.rows([processes.facts(process.pid)?.pgid ?? process.pid, ...mine]).map((row) => [row.pid, row]));
    const orphaned = (row: Row): boolean => row.ppid === 1 || (!byPid.has(row.ppid) && processes.facts(row.ppid) === undefined);
    if (since !== undefined) {
      for (const row of processes.born(since)) if (!byPid.has(row.pid) && orphaned(row)) byPid.set(row.pid, row);
    }
    const table = [...byPid.values()];
    const under = (row: Row, set: ReadonlySet<number> | ReadonlyMap<number, unknown>): boolean => {
      for (let at: Row | undefined = row, steps = 0; at !== undefined && steps < 64; at = byPid.get(at.ppid), steps += 1) {
        if (set.has(at.pid) || set.has(at.ppid)) return true;
      }
      return false;
    };
    const self = new Set([process.pid]);
    const unheld = table.filter((row) => row.pid !== process.pid && !row.zombie && !internal.has(row.pid) && !under(row, held));
    const owned = claimedBy(processes, unheld);
    const candidates = unheld.filter((row) => !under(row, owned));
    const orphans = candidates.filter((row) => row.marks.length === 0 && orphaned(row)).map((row) => row.pid);
    const where = orphans.length === 0 ? new Map<number, string>() : processes.cwds(orphans);
    return candidates.filter(
      (row) =>
        mine.has(row.pid) || mine.has(row.pgid) || row.marks.includes(token) || under(row, self) || within(where.get(row.pid) ?? '', root),
    );
  };

  const describe = (processes: Processes, rows: readonly Row[], fallback: string): string[] => {
    const holds = databases(rows.map((row) => row.pid));
    const where = processes.cwds(rows.map((row) => row.pid));
    return rows.map((row) => {
      const origin = children.find(row.pid) ?? spawned.find((child) => child.pid === row.pid);
      const file = origin?.file ?? fallback;
      const site = origin?.site === undefined || origin.site === '' ? '' : `\n      spawned at ${origin.site}`;
      const files = holds.get(row.pid);
      const held = files === undefined ? '' : `\n      holds ${[...new Set(files)].join(', ')}`;
      const command = (processes.command(row.pid) ?? '?').slice(0, 160);
      return `  ${row.pid} ${command}  (cwd ${where.get(row.pid) ?? '?'})  from ${relative(options.cwd, file)}${site}${held}`;
    });
  };

  return {
    children,
    process: process_,
    begin(): void {
      since = options.processes()?.clock();
    },
    hold: holdProcess,
    holding(): () => void {
      holding += 1;
      let open = true;
      return () => {
        if (open) holding -= 1;
        open = false;
      };
    },
    claim(home: string): () => void {
      homes.set(home, (homes.get(home) ?? 0) + 1);
      let open = true;
      return () => {
        if (!open) return;
        open = false;
        const left = (homes.get(home) ?? 1) - 1;
        if (left === 0) homes.delete(home);
        else homes.set(home, left);
      };
    },
    release,
    spawnedCount(): ByKind<{ count: number; unmeasured: number }> {
      const counts: ByKind<{ count: number; unmeasured: number }> = {
        sqlite: { count: 0, unmeasured: 0 },
        git: { count: 0, unmeasured: 0 },
        other: { count: 0, unmeasured: 0 },
      };
      for (const child of spawned) {
        counts[child.kind].count += 1;
        if (!child.measured) counts[child.kind].unmeasured += 1;
      }
      return counts;
    },
    async verdict(token: string, root: string, file: string): Promise<Residue | undefined> {
      const processes = options.processes();
      if (processes !== undefined) unclaimGone(processes);
      const mine = new Set(spawned.flatMap((child) => (child.pid === undefined || held.has(child.pid) ? [] : [child.pid])));
      const any = spawned.length > 0;
      spawned = [];
      if (!any || processes === undefined) return undefined;
      let found = suspects(processes, token, root, mine);
      if (found.length === 0) return undefined;
      for (const deadline = Date.now() + GRACE_MS; found.length > 0 && Date.now() < deadline;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        found = found.filter((row) => {
          const facts = processes.facts(row.pid);
          return facts !== undefined && !facts.zombie && facts.start === row.start;
        });
      }
      found = suspects(processes, token, root, mine);
      if (found.length === 0) return undefined;
      const lines = describe(processes, found, file);
      for (const row of found) kill(row.pid);
      return {
        count: found.length,
        message: `${found.length} process(es) outlived the tests that started them and were killed:\n${lines.join('\n')}`,
      };
    },
  };
};

export type Watch = ReturnType<typeof makeWatch>;

const databases = (pids: readonly number[]): Map<number, string[]> => {
  const found = new Map<number, string[]>();
  if (pids.length === 0 || process.platform !== 'darwin') return found;
  const run = pristine((createRequire(import.meta.url)('node:child_process') as ChildProcess).execFileSync);
  let listed = '';
  try {
    listed = run('/usr/sbin/lsof', ['-w', '-a', '-p', pids.join(','), '-d', '^txt', '-Fpn'], {
      encoding: 'utf8',
      env: {},
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    listed = String((error as { stdout?: unknown }).stdout ?? '');
  }
  let pid = 0;
  for (const line of listed.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (/^n.*\.(sqlite|db)$/.test(line)) found.set(pid, [...(found.get(pid) ?? []), line.slice(1)]);
  }
  return found;
};

const living = (pid: number, row: Facts | undefined): boolean => (row === undefined ? alive(pid) : !row.zombie);

const liveness = (table: readonly Row[]): ((pid: number) => boolean) => {
  const listed = new Map(table.map((row) => [row.pid, row]));
  return (pid) => living(pid, listed.get(pid));
};

const rootOwner = (entry: string): number | undefined => {
  const owner = Number(/^(?:run\.)?(\d+)\./.exec(entry)?.[1]);
  return Number.isInteger(owner) && owner > 0 ? owner : undefined;
};

const endedRoots = (base: string, entries: readonly string[], living: (pid: number) => boolean): string[] =>
  entries
    .filter((entry) => {
      const owner = rootOwner(entry);
      return owner !== undefined && !living(owner);
    })
    .map((entry) => `${base}/${entry}`);

export type RunLiveness = 'alive' | 'dead' | 'unknown';
export const runLiveness = (processes: Processes, entry: string): RunLiveness => {
  const owner = rootOwner(entry);
  return owner === undefined ? 'unknown' : living(owner, processes.facts(owner)) ? 'alive' : 'dead';
};

export const sweep = (
  processes: Processes,
  base: string,
  entries: readonly string[],
): { readonly stranded: number; readonly roots: string[] } => {
  const table = processes.rows('all');
  const living = liveness(table);
  const deadRoots = endedRoots(base, entries, living);
  const stranded = new Set(
    table.filter((row) => row.pid !== process.pid && !row.zombie && row.marks.some((mark) => !living(ownerOf(mark)))).map((row) => row.pid),
  );
  if (deadRoots.length > 0) {
    const where = processes.cwds(
      table.filter((row) => row.pid !== process.pid && !row.zombie && !stranded.has(row.pid)).map((row) => row.pid),
    );
    for (const [pid, cwd] of where) if (deadRoots.some((root) => within(cwd, root))) stranded.add(pid);
  }
  for (const pid of stranded) kill(pid);
  return { stranded: stranded.size, roots: deadRoots };
};
