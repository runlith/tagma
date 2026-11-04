import { createHash } from 'node:crypto';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { dlopen, FFIType } from 'bun:ffi';
import { Cause, Clock, Deferred, Effect, Fiber, FileSystem, Schema } from 'effect';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import type { HeldExecution, NextBundle } from '../../holder/Holder';
import { readUntil, writeAll } from '../../holder/testing/Adapter';
import { CONTROL_VARIABLE, openHolder } from '../PosixHolder';
import { report } from './report';
import { testSystem } from '../../composition/testing/system';

const [library, state, HOLDER_PART, STANDING_HOLDER] = process.argv.slice(2) as [string, string, string, string];
const RUNTIME_PART = 'runtime/bun';
const HOST_PART = 'host/entry.ts';
const ENTRY = 'holder.entry';
const ENTERED = 'entered';
const STALE = 'stale';
const VERIFYING = 'verifying';
const env = [
  { name: 'PATH', value: '/usr/bin:/bin' },
  { name: 'LC_ALL', value: 'C' },
  { name: 'TERM', value: 'dumb' },
];
const F_GETFL = 3;
const monotonicMs = Effect.map(Clock.monotonicTimeNanos, (nanos) => Number(nanos) / 1_000_000);
const Phase = Schema.fromJsonString(Schema.Struct({ phase: Schema.optional(Schema.Number) }));
const reported = Effect.fn('posix.succession.reported')(function* () {
  const files = yield* FileSystem.FileSystem;
  const text = yield* files
    .readFileString(join(state, 'report.jsonl'))
    .pipe(Effect.catchReason('PlatformError', 'NotFound', () => Effect.succeed(undefined)));
  return text === undefined ? [] : yield* Effect.forEach(text.trim().split('\n'), (line) => Schema.decodeUnknownEffect(Phase)(line));
});
const digest = Effect.fn('posix.succession.digest')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  return createHash('sha256')
    .update(yield* files.readFile(path))
    .digest('hex');
});

const flags = Effect.fn('posix.succession.flags')(function* () {
  const files = yield* FileSystem.FileSystem;
  const system = yield* testSystem;
  const libc = yield* Effect.acquireRelease(
    Effect.try({
      try: () => dlopen(system.libc, { fcntl: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } }),
      catch: (cause) => new Cause.UnknownError(cause, String(cause)),
    }),
    (library) => Effect.sync(() => library.close()),
  );
  return Object.fromEntries(
    (yield* files.readDirectory('/dev/fd'))
      .map(Number)
      .filter((fd) => fd > 2)
      .map((fd) => [String(fd), libc.symbols.fcntl(fd, F_GETFL)] as const)
      .filter(([, value]) => value >= 0),
  );
}, Effect.scoped);

const pipes = (execution: HeldExecution) => {
  if (execution.channels._tag !== 'pipes') throw new Error(`${execution.id} is not on pipes`);
  return execution.channels;
};

const terminal = (execution: HeldExecution) => {
  if (execution.channels._tag !== 'pty' || execution.channels.terminal === undefined)
    throw new Error(`${execution.id} holds no open terminal`);
  return execution.channels.terminal;
};

const exchange = (execution: HeldExecution, line: string) =>
  execution.channels._tag === 'pty'
    ? Effect.flatMap(writeAll(terminal(execution), `${line}\n`), () =>
        Effect.map(readUntil(terminal(execution), `pty:${line}`), (bytes) => bytes.includes(Buffer.from(`pty:${line}`))),
      )
    : Effect.flatMap(writeAll(pipes(execution).stdin!, `${line}\n`), () =>
        Effect.map(readUntil(pipes(execution).stdout, `out:${line}`), (bytes) => bytes.includes(Buffer.from(`out:${line}`))),
      );

const command = (pid: number) =>
  Bun.spawnSync(['/bin/ps', '-o', 'args=', '-p', String(pid)])
    .stdout.toString()
    .trim();

const part = Effect.fn('posix.succession.part')(function* (path: string) {
  const files = yield* FileSystem.FileSystem;
  const placed = join(state, 'bundle.next', path);
  yield* files.makeDirectory(dirname(placed), { recursive: true });
  yield* files.remove(placed, { force: true });
  return placed;
});

const candidate = Effect.fn('posix.succession.candidate')(function* (
  holder: 'kept' | 'executable' | 'unexecutable' | 'hanging' | 'runtimeless' | 'misstarting' | 'aborting',
) {
  const files = yield* FileSystem.FileSystem;
  if (holder === 'hanging') {
    yield* files.writeFileString(
      yield* part(HOLDER_PART),
      `#!/bin/sh\nprintf ready > ${join(state, VERIFYING)}\nexec /bin/cat >/dev/null\n`,
      {
        mode: 0o755,
      },
    );
  } else if (holder === 'misstarting') {
    const misstart = `if [ $# -eq 6 ]; then exec ${STANDING_HOLDER} "$1" "$2" "$3" "$4" "$5" "$6/absent"; fi\nexec ${STANDING_HOLDER} "$@"\n`;
    yield* files.writeFileString(yield* part(HOLDER_PART), `#!/bin/sh\n${misstart}`, { mode: 0o755 });
  } else if (holder === 'aborting') {
    const abort = `use POSIX;\nif ($ARGV[0] eq '--successor') { sigprocmask(SIG_BLOCK, POSIX::SigSet->new(SIGABRT)); kill 'ABRT', $$; }\nexec { '${STANDING_HOLDER}' } '${STANDING_HOLDER}', @ARGV;\n`;
    yield* files.writeFileString(yield* part(HOLDER_PART), `#!/usr/bin/perl\n${abort}`, { mode: 0o755 });
  } else if (holder !== 'kept') {
    const placed = yield* part(HOLDER_PART);
    yield* files.copyFile(STANDING_HOLDER, placed);
    yield* files.chmod(placed, holder === 'unexecutable' ? 0o644 : 0o755);
  }
  const runtime = yield* part(RUNTIME_PART);
  if (holder !== 'runtimeless') yield* files.symlink(process.execPath, runtime);
  const parts = [RUNTIME_PART, HOST_PART];
  const args = [library, state, HOLDER_PART, STANDING_HOLDER, ENTERED, holder];
  const entry = [`holder ${HOLDER_PART}`, ...parts.map((path) => `bundle ${path}`), ...args.map((arg) => `text ${arg}`), ''].join('\n');
  yield* files.writeFileString(yield* part(ENTRY), entry);
  yield* files.writeFileString(yield* part(HOST_PART), `await import(${JSON.stringify(import.meta.path)});\n`);
  const next: NextBundle = {
    holder: HOLDER_PART,
    logic: [...parts.map((path) => join(state, 'bundle', path)), ...args],
  };
  return next;
});

const visit = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const holder = yield* openHolder(library, Number(process.env[CONTROL_VARIABLE]));
  const phase = (yield* reported()).at(-1)?.phase ?? 0;
  const held = Object.fromEntries(holder.held.map((execution) => [execution.id, execution]));

  if (phase === 0) {
    const shell = yield* holder.launch({
      id: 'terminal',
      path: '/bin/sh',
      argv: ['sh', '-c', 'stty -echo; echo ready; while IFS= read -r line; do echo "pty:$line"; done'],
      env,
      cwd: state,
      transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
      pace: 'full',
    });
    const stream = yield* holder.launch({
      id: 'stream',
      path: '/bin/sh',
      argv: ['sh', '-c', 'while IFS= read -r line; do echo "out:$line"; done'],
      env,
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    const leaving = yield* holder.launch({
      id: 'leaving',
      path: '/bin/sh',
      argv: ['sh', '-c', 'read x; exit 7'],
      env,
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    yield* readUntil(terminal(shell), 'ready');
    const before = { terminal: yield* exchange(shell, 'one'), stream: yield* exchange(stream, 'one') };
    const next = yield* candidate('kept');
    const flagsBefore = yield* flags();
    yield* holder.prepare(next);
    const flagsAfter = yield* flags();
    const prepared = { terminal: yield* exchange(shell, 'two'), stream: yield* exchange(stream, 'two') };
    yield* holder.activate;
    yield* report(state, {
      phase: 1,
      holder: holder.pid,
      logic: command(process.pid),
      pids: { terminal: shell.pid, stream: stream.pid, leaving: leaving.pid },
      before,
      prepared,
      flagsBefore,
      flagsAfter,
    });
    yield* writeAll(pipes(leaving).stdin!, 'x\n');
    return;
  }

  if (phase === 1) {
    const stale = yield* Effect.result(holder.activate);
    const leaving = held['leaving']!;
    const exit = yield* leaving.exit;
    const unreaped = leaving.reaped === undefined;
    const reap = yield* leaving.reap;
    yield* leaving.release;
    const exchanged = { terminal: yield* exchange(held['terminal']!, 'three'), stream: yield* exchange(held['stream']!, 'three') };
    const unexecutable = yield* candidate('unexecutable');
    const refused = yield* Effect.result(holder.prepare(unexecutable));
    const misstarting = yield* candidate('misstarting');
    const misstarted = yield* Effect.result(holder.prepare(misstarting));
    yield* holder.prepare(yield* candidate('runtimeless'));
    yield* holder.activate;
    yield* report(state, {
      phase: 2,
      holder: holder.pid,
      command: command(holder.pid),
      logic: command(process.pid),
      pids: { terminal: held['terminal']?.pid, stream: held['stream']?.pid },
      leaving: { exit, unreaped, reap: reap.exit },
      exchanged,
      refused: refused._tag === 'Failure' ? refused.failure.reason : 'accepted',
      stale: stale._tag === 'Failure' ? stale.failure.reason : 'accepted',
      misstarted: misstarted._tag === 'Failure' ? misstarted.failure.reason : 'accepted',
    });
    return;
  }

  const standing = (yield* digest(join(state, 'bundle', HOLDER_PART))) === (yield* digest(STANDING_HOLDER));
  if (phase === 2) {
    const exchanged = { terminal: yield* exchange(held['terminal']!, 'four'), stream: yield* exchange(held['stream']!, 'four') };
    const restored = { standing, candidate: yield* files.exists(join(state, 'bundle.next', HOLDER_PART)) };
    const ending = yield* holder.launch({
      id: 'ending',
      path: '/bin/sh',
      argv: ['sh', '-c', 'cat >/dev/null; exit 5'],
      env,
      cwd: state,
      transport: { _tag: 'pipes', stdin: 'pipe' },
      pace: 'full',
    });
    const next = yield* candidate('hanging');
    const verifying = yield* Deferred.make<void>();
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        watch(state, (_, file) => {
          if (file === VERIFYING) Effect.runSync(Deferred.succeed(verifying, undefined));
        }),
      ),
      (watcher) => Effect.sync(() => watcher.close()),
    );
    const asked = yield* monotonicMs;
    const preparing = yield* Effect.forkChild(Effect.result(holder.prepare(next)));
    yield* Effect.raceFirst(
      Deferred.await(verifying),
      Effect.flatMap(Fiber.join(preparing), (verdict) =>
        verdict._tag === 'Failure'
          ? Effect.fail(verdict.failure)
          : Effect.die(new Error('the preparation completed before its verifier entered')),
      ),
    );
    yield* ending.closeInput;
    const endingExit = yield* ending.exit;
    const overlapping = yield* Effect.result(holder.prepare(next));
    const inputEnded = { verifying: overlapping._tag === 'Failure' && overlapping.failure.reason === 'running', exit: endingExit };
    yield* ending.reap;
    yield* ending.release;
    const hung = yield* Fiber.join(preparing);
    const waited = (yield* monotonicMs) - asked;
    const kept = {
      held: holder.held.length,
      terminal: yield* exchange(held['terminal']!, 'hung'),
      stream: yield* exchange(held['stream']!, 'hung'),
    };
    yield* holder.prepare(yield* candidate('aborting'));
    yield* holder.activate;
    yield* report(state, {
      phase: 3,
      holder: holder.pid,
      command: command(holder.pid),
      logic: command(process.pid),
      pids: { terminal: held['terminal']?.pid, stream: held['stream']?.pid },
      exchanged,
      restored,
      hung: { reason: hung._tag === 'Failure' ? hung.failure.reason : 'accepted', waited, kept },
      inputEnded,
    });
    process.exit(1);
  }

  if (!standing) {
    const next = yield* candidate('executable');
    yield* holder.prepare({ ...next, logic: [...next.logic, STALE] });
    process.exit(75);
  }

  const shell = held['terminal']!;
  const stream = held['stream']!;
  const exchanged = { terminal: yield* exchange(shell, 'five'), stream: yield* exchange(stream, 'five') };
  yield* shell.act('leader', 'kill');
  yield* shell.exit;
  yield* shell.reap;
  yield* shell.release;
  yield* stream.closeInput;
  const streamExit = yield* stream.exit;
  yield* stream.reap;
  yield* stream.release;
  yield* report(state, {
    phase: 4,
    holder: holder.pid,
    command: command(holder.pid),
    logic: command(process.pid),
    pids: { terminal: shell.pid, stream: stream.pid },
    exchanged,
    streamExit,
    entered: process.argv.includes(ENTERED),
    stale: process.argv.includes(STALE),
  });
  yield* holder.vacate;
});

await Effect.runPromise(visit.pipe(Effect.scoped, Effect.provide(BunFileSystem.layer))).catch(async (error: unknown) => {
  await Effect.runPromise(report(state, { failed: String(error) }).pipe(Effect.provide(BunFileSystem.layer)));
  process.kill(process.ppid, 'SIGKILL');
});
