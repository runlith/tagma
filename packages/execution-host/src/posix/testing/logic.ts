import { join } from 'node:path';
import { Cause, Clock, Effect, FileSystem, Schedule, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { HeldExecution, Readable } from '../../holder/Holder';
import { writeAll } from '../../holder/testing/Adapter';
import { CONTROL_VARIABLE, openHolder } from '../PosixHolder';
import { terminalFacts } from './terminal';
import { report } from './report';

const [library, state, holderProgram] = process.argv.slice(2) as [string, string, string];
const CRASH = join(state, 'crashed');
const SERVED = join(state, 'served');
const env = [
  { name: 'PATH', value: '/usr/bin:/bin' },
  { name: 'LC_ALL', value: 'C' },
  { name: 'TERM', value: 'dumb' },
];
const SEEN_BEFORE_LEAVING = 40_000;

const FirstReport = Schema.fromJsonString(Schema.Struct({ member: Schema.Number }));

const readUntil = Effect.fn('posix.logic.readUntil')(function* (source: Readable, done: (seen: string) => boolean, file?: string) {
  const files = yield* FileSystem.FileSystem;
  const saved = file === undefined ? undefined : yield* files.open(join(state, file), { flag: 'a' });
  let seen = '';
  while (!done(seen)) {
    const chunk = yield* source.read();
    if (chunk === undefined) break;
    if (saved !== undefined) yield* saved.writeAll(chunk);
    seen += Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1');
  }
  return seen;
}, Effect.scoped);

const pipes = (execution: HeldExecution) => {
  if (execution.channels._tag !== 'pipes') throw new Error(`${execution.id} is not on pipes`);
  return execution.channels;
};

const terminal = (execution: HeldExecution) => {
  if (execution.channels._tag !== 'pty' || execution.channels.terminal === undefined) {
    throw new Error(`${execution.id} holds no open terminal`);
  }
  return execution.channels.terminal;
};

const alive = (pid: number) =>
  Effect.try({
    try: () => {
      process.kill(pid, 0);
      return true;
    },
    catch: (cause) => new Cause.UnknownError(cause, String(cause)),
  }).pipe(
    Effect.catchIf(
      (error) => error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'ESRCH',
      () => Effect.succeed(false),
    ),
  );

const parentage = (pids: ReadonlyArray<number>) =>
  Object.fromEntries(
    Bun.spawnSync(['/bin/ps', '-o', 'pid=,ppid=,pgid=,stat=', '-p', pids.join(',')])
      .stdout.toString()
      .trim()
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .map(([pid, ppid, pgid, stat]) => [pid, { ppid: Number(ppid), pgid: Number(pgid), stat }]),
  );

const arrive = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]));
  if (holder.held.length === 0) {
    if ((yield* holder.generation) !== undefined) return yield* Effect.die(new Error('a new holder already has a generation'));
    yield* holder.bindGeneration(37);
    yield* holder.bindGeneration(37);
    const rebinding = yield* Effect.result(holder.bindGeneration(38));
    const refusedGeneration = rebinding._tag === 'Failure' ? rebinding.failure.reason : 'accepted';
    const stream = yield* holder.launch({
      id: 'stream',
      path: '/bin/sh',
      argv: ['sh', '-c', 'read go; seq 1 20000; echo err >&2; cat'],
      env,
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    yield* writeAll(pipes(stream).stdin!, 'go\n');
    const seen = yield* readUntil(pipes(stream).stdout, (seen) => seen.length >= SEEN_BEFORE_LEAVING, 'stream.1');

    const group = yield* holder.launch({
      id: 'group',
      path: '/bin/sh',
      argv: ['sh', '-c', "/usr/bin/perl -e 'sleep while 1' & echo $!; read x; exit 7"],
      env,
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    const member = Number((yield* readUntil(pipes(group).stdout, (seen) => seen.includes('\n'))).trim());

    const shell = yield* holder.launch({
      id: 'terminal',
      path: '/bin/sh',
      argv: ['sh', '-c', 'stty -echo; echo ready; while IFS= read -r line; do echo "pty:$line"; done'],
      env,
      cwd: state,
      transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
      pace: 'full',
    });
    yield* readUntil(terminal(shell), (seen) => seen.includes('ready'));
    yield* writeAll(terminal(shell), 'one\n');
    const answered = yield* readUntil(terminal(shell), (seen) => seen.includes('pty:one'));

    yield* writeAll(pipes(group).stdin!, 'x\n');
    yield* report(state, {
      phase: 1,
      generation: yield* holder.generation,
      refusedGeneration,
      logic: process.pid,
      holder: holder.pid,
      pids: { stream: stream.pid, group: group.pid, terminal: shell.pid },
      groups: { stream: stream.work, group: group.work, terminal: shell.work },
      member,
      seen: seen.length,
      answered: answered.includes('pty:one'),
    });
    return;
  }

  if (!(yield* files.exists(CRASH))) {
    yield* files.writeFileString(CRASH, String(yield* Clock.currentTimeMillis));
    process.exit(1);
  }
  if (!(yield* files.exists(SERVED))) {
    yield* holder.ready;
    yield* files.writeFileString(SERVED, String(yield* Clock.currentTimeMillis));
    process.exit(1);
  }
  const served = Number(yield* files.readFileString(SERVED));
  const paused = served - Number(yield* files.readFileString(CRASH));
  const restarted = performance.timeOrigin - served;
  const second = Bun.spawnSync([holderProgram, state, process.execPath, join(state, 'never-started.ts')]);
  const held = Object.fromEntries(holder.held.map((execution) => [execution.id, execution]));
  const stream = held['stream']!;
  const group = held['group']!;
  const shell = held['terminal']!;
  const before = parentage([stream.pid, group.pid, shell.pid, holder.pid]);
  const groupExit = yield* group.exit;
  const facts = yield* terminalFacts(shell);
  yield* report(state, {
    phase: 2,
    generation: yield* holder.generation,
    logic: process.pid,
    holder: holder.pid,
    paused,
    restarted,
    secondHolder: second.exitCode,
    pids: { stream: stream.pid, group: group.pid, terminal: shell.pid },
    groups: { stream: stream.work, group: group.work, terminal: shell.work },
    parentage: before,
    group: { exit: groupExit, reaped: group.reaped !== undefined },
    input: pipes(stream).input,
    terminal: { rows: facts.rows, cols: facts.cols, foreground: facts.foreground, sid: facts.sid },
  });

  yield* writeAll(pipes(stream).stdin!, 'tail\n');
  yield* stream.closeInput;
  yield* readUntil(pipes(stream).stdout, () => false, 'stream.2');
  const errors = yield* readUntil(pipes(stream).stderr, () => false);
  const streamExit = yield* stream.exit;
  const streamReap = yield* stream.reap;
  yield* stream.release;

  const member = (yield* Schema.decodeUnknownEffect(FirstReport)(
    (yield* files.readFileString(join(state, 'report.jsonl'))).split('\n')[0]!,
  )).member;
  const memberBefore = yield* alive(member);
  yield* group.act('work', 'terminate');
  const memberAfter = yield* alive(member).pipe(Effect.repeat({ while: (alive) => alive, schedule: Schedule.spaced(10) }));
  const groupReap = yield* group.reap;
  const afterReap = yield* Effect.result(group.act('work', 'terminate'));
  yield* group.release;

  yield* writeAll(terminal(shell), 'two\n');
  const answered = yield* readUntil(terminal(shell), (seen) => seen.includes('pty:two'));
  yield* terminal(shell).resize(30, 100);
  const resized = yield* terminalFacts(shell);
  yield* shell.act('leader', 'kill');
  const shellExit = yield* shell.exit;
  yield* shell.reap;
  yield* shell.release;

  yield* report(state, {
    phase: 3,
    stream: { errors, exit: streamExit, reap: streamReap },
    group: {
      memberBefore,
      memberAfter,
      reap: groupReap,
      afterReap: afterReap._tag === 'Failure' ? afterReap.failure.reason : 'delivered',
    },
    terminal: { answered: answered.includes('pty:two'), rows: resized.rows, cols: resized.cols, exit: shellExit },
  });
  yield* holder.vacate;
});

await Effect.runPromise(arrive.pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))).catch(async (error: unknown) => {
  await Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer)));
  process.kill(process.ppid, 'SIGKILL');
});
