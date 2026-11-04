import { basename } from 'node:path';
import { Data, Effect, Predicate } from 'effect';
import { spawnedEffect } from '../../platform/testing/spawn.js';

export class ProcessesUnmeasured extends Data.TaggedError('ProcessesUnmeasured')<{
  readonly command: readonly string[];
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    const errno = Predicate.hasProperty(this.cause, 'code') ? ` (${String(this.cause.code)})` : '';
    return `fixture process command ${this.command.join(' ')} failed${errno}: ${this.detail}`;
  }
}

const read = Effect.fn('FixtureProcesses.read')(function* (command: readonly string[]) {
  const result = yield* spawnedEffect(command);
  if (result.exitCode === 0) return new TextDecoder().decode(result.stdout);
  if (result.exitCode === 1 && (command[0] === 'pgrep' || (command[0] === 'ps' && result.stderr.length === 0))) return '';
  return yield* new ProcessesUnmeasured({
    command,
    detail: `exit ${result.exitCode}, signal ${result.signalCode}: ${result.stderr.toString()}`,
  });
});

const hosts = Effect.fn('FixtureProcesses.hosts')(function* (root: string) {
  if (root === '') return [];
  const pids = (yield* read(['pgrep', '-f', root]))
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  if (pids.length === 0) return [];
  const command = ['ps', '-o', 'pid=,pgid=,command=', '-p', pids.join(',')];
  const commands = yield* read(command);
  return yield* Effect.try({
    try: () =>
      commands.split('\n').flatMap((line) => {
        const [pid, group, program, ...args] = line.trim().split(/\s+/);
        if (program === undefined || !args.some((arg) => arg.includes(root))) return [];
        const holder = basename(program) === 'execution-holder' && args[0]?.includes(root) === true;
        const logic = args.some((arg) => arg.endsWith('/host/host.js') || arg.endsWith('/src/main.ts'));
        if (!holder && !logic) return [];
        const identity = Number(pid);
        const session = Number(group);
        if (!Number.isSafeInteger(identity) || identity <= 0 || !Number.isSafeInteger(session) || session <= 0) {
          throw new Error(`ps returned no fixture process group: ${line}`);
        }
        return [{ pid: identity, group: session, holder }];
      }),
    catch: (cause) => new ProcessesUnmeasured({ command, detail: String(cause), cause }),
  });
});

const childGroups = Effect.fn('FixtureProcesses.children')(function* (holders: ReadonlySet<number>) {
  if (holders.size === 0) return [];
  const command = ['ps', '-axo', 'pid=,ppid=,pgid='];
  const table = yield* read(command);
  return yield* Effect.try({
    try: () =>
      table.split('\n').flatMap((line) => {
        if (line.trim() === '') return [];
        const [pid, parent, group] = line.trim().split(/\s+/).map(Number);
        if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(parent)) throw new Error(`ps returned no process identity: ${line}`);
        if (!holders.has(parent!) || pid === process.pid) return [];
        if (!Number.isSafeInteger(group) || group! <= 0) throw new Error(`ps returned no process group: ${line}`);
        return [group!];
      }),
    catch: (cause) => new ProcessesUnmeasured({ command, detail: String(cause), cause }),
  });
});

export const hostsUnder = (root: string) => Effect.map(hosts(root), (standing) => standing.map((host) => host.pid));

export const endHosts = Effect.fn('FixtureProcesses.end')(function* (root: string) {
  const standing = yield* hosts(root);
  const holders = new Set(standing.filter((host) => host.holder).map((host) => host.pid));
  const groups = new Set([
    ...standing.filter((host) => host.holder).map((host) => host.group),
    ...standing.filter((host) => !host.holder).map((host) => host.group),
    ...(yield* childGroups(holders)),
  ]);
  for (const group of groups) {
    yield* Effect.try({
      try: () => {
        try {
          process.kill(-group, 'SIGKILL');
        } catch (cause) {
          //! Darwin answers EPERM for a group whose every member is already a zombie.
          if (!(cause instanceof Error && 'code' in cause && (cause.code === 'ESRCH' || cause.code === 'EPERM'))) throw cause;
        }
      },
      catch: (cause) => new ProcessesUnmeasured({ command: ['kill', '-KILL', String(-group)], detail: String(cause), cause }),
    });
  }
  for (;;) {
    const left = yield* hostsUnder(root);
    if (left.length === 0) return left;
    yield* Effect.sleep(20);
  }
});
