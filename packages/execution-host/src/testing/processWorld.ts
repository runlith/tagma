import { Effect } from 'effect';
import type { StopStep } from '@runlith/executions/protocol/call';
import type { ProgramRuleCopy } from '@runlith/executions/protocol/command';
import type { Climb, LadderAim, Opening } from '@runlith/executions/stopLadder';
import type { ProcessReader } from '../ProcessReader';
import type { ProcessWitness } from '@runlith/executions/protocol/evidence';

export const ROOT = '/root';
export const LEADER = 100;
export const MINUTE = 60_000;

type Proc = {
  readonly pid: number;
  parent: number;
  readonly birth: string;
  args: ReadonlyArray<string>;
  exe: string;
  folder: string;
  deaf?: boolean;
  unreadable?: boolean;
};

export class World {
  readonly procs = new Map<number, Proc>();
  readonly signals: Array<readonly [number, string]> = [];
  readonly files = new Set<string>();

  spawn(pid: number, parent: number, args: ReadonlyArray<string>, folder = ROOT, exe = `/usr/bin/${args[0]}`): Proc {
    const proc = { pid, parent, birth: String(500 + pid), args, exe, folder };
    this.procs.set(pid, proc);
    return proc;
  }

  exit(pid: number): void {
    this.procs.delete(pid);
    for (const proc of this.procs.values()) if (proc.parent === pid) proc.parent = 1;
  }

  signalled(pid: number): ReadonlyArray<string> {
    return this.signals.filter(([at]) => at === pid).map(([, signal]) => signal);
  }

  readonly reader: ProcessReader = {
    members: (work) => Effect.map(this.reader.table, (rows) => rows.filter((row) => row.work === work)),
    table: Effect.sync(() =>
      [...this.procs.values()].map((proc) => ({ pid: proc.pid, parent: proc.parent, work: LEADER, birth: proc.birth, zombie: false })),
    ),
    facts: (pids) =>
      Effect.sync(() => ({
        processes: pids.flatMap((pid) => {
          const proc = this.procs.get(pid);
          return proc === undefined
            ? []
            : [
                {
                  pid,
                  parent: proc.parent,
                  work: LEADER,
                  birth: proc.birth,
                  args:
                    proc.unreadable === true
                      ? { _tag: 'Unreadable' as const, detail: 'denied' }
                      : { _tag: 'Read' as const, value: proc.args },
                  executable: { _tag: 'Read' as const, value: proc.exe },
                  folder: { _tag: 'Read' as const, value: proc.folder },
                },
              ];
        }),
        unread: pids.filter((pid) => !this.procs.has(pid)).map((pid) => ({ pid, _tag: 'Gone' as const })),
      })),
    scan() {
      return this.table;
    },
    compareBirth: (left, right) => Number(left) - Number(right),
    bornBetween: () => false,
    identity: (pid) => {
      const proc = this.procs.get(pid);
      return proc === undefined
        ? { _tag: 'Gone' }
        : { _tag: 'Read', pid, parent: proc.parent, work: LEADER, birth: proc.birth, zombie: false };
    },
  };

  readonly kill = ({ pid }: ProcessWitness, signal: string): Effect.Effect<boolean> =>
    Effect.sync(() => {
      this.signals.push([pid, signal]);
      if (this.procs.get(pid)?.deaf !== true) this.exit(pid);
      return true;
    });
}

const LADDER: ReadonlyArray<StopStep> = ['terminate', 'kill'];

export const climbAt = Effect.fnUntraced(function* (first: Opening, aims: ReadonlyArray<LadderAim>): Effect.fn.Return<Climb> {
  const endedAt: Array<Climb['endedAt'][number]> = aims.map(() => undefined);
  const steps: StopStep[] = [];
  const read = Effect.fnUntraced(function* (at: Climb['endedAt'][number]) {
    for (const [index, aim] of aims.entries()) if (endedAt[index] === undefined && (yield* aim.gone)) endedAt[index] = at;
    return endedAt.every((one) => one !== undefined);
  });
  if (yield* read('unsignalled')) return { steps, endedAt, opened: false };
  for (const signal of [first, ...LADDER]) {
    for (const [index, aim] of aims.entries()) if (endedAt[index] === undefined) yield* aim.send(signal);
    steps.push(signal);
    if (yield* read(signal)) break;
  }
  return { steps, endedAt, opened: false };
});

export const rule = (id: string, words: [string, ...string[]], limitMs: number, folder?: string, thread?: string): ProgramRuleCopy => ({
  id,
  thread: thread,
  program: { words, folder: folder },
  limitMs,
  writer: 'operator',
  at: new Date(0).toISOString(),
  words: id,
});
