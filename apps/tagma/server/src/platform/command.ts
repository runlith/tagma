import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { Clock, Duration, Effect } from 'effect';

type Answered = {
  readonly status: number | null;
  readonly text: string;
  readonly out: string;
  readonly err: string;
};

type Launch = {
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly sink?: number;
  readonly group?: { readonly started: (pid: number) => Effect.Effect<void> };
};

const CHILD_GRACE = Duration.seconds(2);
const GROUP_GRACE = Duration.seconds(10);
const KILL_GRACE = Duration.seconds(2);
const POLL = Duration.millis(100);

const signalGroup = (group: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(-group, signal);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const signalPid = (pid: number): boolean => {
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const settledWithin = Effect.fnUntraced(function* (settled: () => boolean, within: Duration.Input) {
  const limit = Duration.toMillis(within);
  const start = yield* Clock.currentTimeMillis;
  while (!settled()) {
    if ((yield* Clock.currentTimeMillis) - start >= limit) return false;
    yield* Effect.sleep(POLL);
  }
  return true;
});

const groupGone = (group: number, within: Duration.Input): Effect.Effect<boolean> => settledWithin(() => !signalGroup(group, 0), within);

const launched = (command: string, args: readonly string[], launch: Launch) => {
  const child = spawn(command, [...args], {
    cwd: launch.cwd,
    env: launch.env,
    stdio: launch.sink === undefined ? ['ignore', 'pipe', 'pipe'] : ['ignore', launch.sink, launch.sink],
    detached: launch.group !== undefined,
  });
  let out = '';
  let err = '';
  let exited = false;
  const answer = new Promise<Answered>((resolve) => {
    const end = (status: number | null, extra: string) => {
      if (exited) return;
      exited = true;
      resolve({ status, text: `${out}${err}${extra}`, out, err });
    };
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => (err += chunk.toString('utf8')));
    child.on('error', (error) => end(null, error.message));
    child.on('close', (code, by) => end(code, by === null ? '' : `${basename(command)} ended on ${by}`));
  });
  return { child, answer, ended: () => exited };
};

const printed = (command: string, args: readonly string[]): Effect.Effect<string | null> =>
  Effect.map(answered(command, args), (answer) => (answer.status === 0 ? answer.out : null));

const descendantsOf = Effect.fn('Command.descendants')(function* (group: number) {
  const listed = yield* printed('ps', ['-A', '-o', 'pid=,ppid=,pgid=']);
  if (listed === null) return [];
  const rows = listed
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row): row is [number, number, number] => row.length === 3 && row.every(Number.isInteger));
  const found = new Set(rows.filter(([, , pgid]) => pgid === group).map(([pid]) => pid));
  for (let grew = true; grew;) {
    grew = false;
    for (const [pid, ppid] of rows) {
      if (found.has(ppid) && !found.has(pid)) {
        found.add(pid);
        grew = true;
      }
    }
  }
  return [...found];
});

export const endGroup = Effect.fn('Command.endGroup')(function* (group: number) {
  signalGroup(group, 'SIGTERM');
  if (yield* groupGone(group, GROUP_GRACE)) return;
  const descendants = yield* descendantsOf(group);
  signalGroup(group, 'SIGKILL');
  for (const pid of descendants) {
    signalGroup(pid, 'SIGKILL');
    signalPid(pid);
  }
  yield* groupGone(group, KILL_GRACE);
});

export const commandOf = Effect.fn('Command.commandOf')(function* (pid: number) {
  const command = yield* printed('ps', ['-o', 'command=', '-p', String(pid)]);
  return command?.trim() ?? null;
});

const endChild = Effect.fnUntraced(function* (
  child: ReturnType<typeof launched>['child'],
  answer: Promise<Answered>,
  ended: () => boolean,
) {
  child.kill('SIGTERM');
  if (yield* settledWithin(ended, CHILD_GRACE)) return;
  child.kill('SIGKILL');
  yield* Effect.promise(() => answer);
});

export const answered = (command: string, args: readonly string[], launch: Launch = {}): Effect.Effect<Answered> =>
  Effect.acquireUseRelease(
    Effect.sync(() => launched(command, args, launch)),
    ({ child, answer }) =>
      Effect.andThen(
        child.pid === undefined ? Effect.void : (launch.group?.started(child.pid) ?? Effect.void),
        Effect.promise(() => answer),
      ),
    ({ child, answer, ended }) =>
      ended() ? Effect.void : launch.group !== undefined && child.pid !== undefined ? endGroup(child.pid) : endChild(child, answer, ended),
  );

export const refusalOf = (command: string, answer: Pick<Answered, 'status' | 'text'>): string | null =>
  answer.status === 0 ? null : answer.text.trim() || `${basename(command)} exited ${answer.status ?? 'without starting'}`;
