import { dlopen, FFIType, ptr, read } from 'bun:ffi';
import { Effect, FileSystem, Schedule, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { randomUUID } from 'node:crypto';
import { constants, userInfo } from 'node:os';
import { join } from 'node:path';
import { HolderUnavailable } from '../../holder-client/Connection';

const SYMBOLS = {
  socket: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  bind: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  listen: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  accept: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
  fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  kill: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  __error: { args: [], returns: FFIType.ptr },
} as const;

const LAUNCH = [
  'use IO::Socket::UNIX; use POSIX;',
  'my ($path, $pidfile, $exitfile, $errors, @cmd) = @ARGV;',
  'sub note { my ($path, $text) = @_; open(my $f, ">", "$path.next") or die "open $path: $!"; print $f $text; close $f or die "close $path: $!"; rename("$path.next", $path) or die "publish $path: $!"; }',
  'eval {',
  'my $peer = IO::Socket::UNIX->new(Type => SOCK_STREAM, Peer => $path) or die "connect: $!";',
  'POSIX::dup2(fileno($peer), 0) >= 0 or die "stdin: $!";',
  'my $pid = fork(); defined($pid) or die "fork: $!";',
  'if (!$pid) { exec {$cmd[0]} @cmd; die "exec: $!"; }',
  'note($pidfile, $pid);',
  'waitpid($pid, 0) == $pid or die "wait: $!"; my $code = $? & 127 ? 128 + ($? & 127) : $? >> 8;',
  'note($exitfile, $code);',
  '}; if ($@) { note($errors, $@); exit 1; }',
].join(' ');

const escaped = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const job = (label: string, argv: ReadonlyArray<string>) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>Label</key><string>${escaped(label)}</string>`,
    `<key>ProgramArguments</key><array>${argv.map((arg) => `<string>${escaped(arg)}</string>`).join('')}</array>`,
    '<key>ProcessType</key><string>Interactive</string>',
    '<key>RunAtLoad</key><true/>',
    '</dict></plist>',
  ].join('\n');

const unavailable = (detail: string) => new HolderUnavailable({ detail });
const failed = (error: unknown) => (error instanceof HolderUnavailable ? error : unavailable(String(error)));

export type FixtureProcess = {
  readonly exited: Effect.Effect<number, HolderUnavailable>;
  readonly exitCode: () => number | null;
  readonly kill: Effect.Effect<void, HolderUnavailable>;
};

export const isolatedProcess = Effect.fn('posix.testing.isolatedProcess')(
  function* (command: ReadonlyArray<string>) {
    const files = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const directory = yield* files.makeTempDirectoryScoped({ directory: '/tmp', prefix: 'host-isolated-' });
    const path = join(directory, 'peer');
    const pidfile = join(directory, 'pid');
    const exitfile = join(directory, 'exit');
    const errors = join(directory, 'errors');
    const label = `runlith.test.${randomUUID()}`;
    const sockets = yield* Effect.acquireRelease(
      Effect.try({ try: () => dlopen('libc.dylib', SYMBOLS), catch: (error) => unavailable(String(error)) }),
      (loaded) => Effect.sync(() => loaded.close()),
    );
    const errno = () => {
      const address = sockets.symbols.__error();
      return address === null ? undefined : read.i32(address, 0);
    };
    const nonblocking = (fd: number) => sockets.symbols.fcntl(fd, 2, 1) >= 0 && sockets.symbols.fcntl(fd, 4, 4) >= 0;
    const listener = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const fd = sockets.symbols.socket(1, 1, 0);
          if (fd < 0) throw new Error(`socket: ${errno()}`);
          return fd;
        },
        catch: (error) => unavailable(String(error)),
      }),
      (fd) => Effect.sync(() => void sockets.symbols.close(fd)),
    );
    const address = new Uint8Array(106);
    address[0] = address.length;
    address[1] = 1;
    address.set(new TextEncoder().encode(path), 2);
    if (
      !nonblocking(listener) ||
      sockets.symbols.bind(listener, ptr(address), address.length) !== 0 ||
      sockets.symbols.listen(listener, 1) !== 0
    )
      return yield* unavailable(`the isolated holder listener could not open: ${errno()}`);
    const launchctl = Effect.fn('posix.testing.launchctl')(function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(ChildProcess.make('/bin/launchctl', args, { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
      const stderr = Buffer.concat(yield* Stream.runCollect(child.stderr)).toString();
      const code = yield* child.exitCode;
      if (code !== 0) return yield* unavailable(`launchctl ${args[0]} exited ${code}: ${stderr}`);
    }, Effect.scoped);
    const domain = `gui/${userInfo().uid}`;
    const plist = join(directory, 'job.plist');
    yield* files.writeFileString(plist, job(label, ['/usr/bin/perl', '-e', LAUNCH, path, pidfile, exitfile, errors, ...command]));
    yield* Effect.acquireRelease(launchctl(['bootstrap', domain, plist]), () =>
      launchctl(['bootout', `${domain}/${label}`]).pipe(Effect.orDie),
    );
    const failure = Effect.gen(function* () {
      if (yield* files.exists(errors)) return yield* unavailable(yield* files.readFileString(errors));
    });
    let connected: number | undefined;
    const disconnect = Effect.sync(() => {
      if (connected === undefined) return;
      sockets.symbols.close(connected);
      connected = undefined;
    });
    const fd = yield* Effect.acquireRelease(
      Effect.gen(function* () {
        yield* failure;
        const accepted = sockets.symbols.accept(listener, null, null);
        if (accepted >= 0) {
          if (nonblocking(accepted)) {
            connected = accepted;
            return accepted;
          }
          sockets.symbols.close(accepted);
          return yield* unavailable(`the isolated holder socket could not become nonblocking: ${errno()}`);
        }
        if (errno() !== constants.errno.EAGAIN && errno() !== constants.errno.EINTR) return yield* unavailable(`accept: ${errno()}`);
        return undefined;
      }).pipe(Effect.repeat({ while: (fd) => fd === undefined, schedule: Schedule.spaced(5) })),
      () => disconnect,
    );
    if (fd === undefined) return yield* unavailable('the isolated holder connected without a descriptor');
    yield* files.exists(pidfile).pipe(Effect.repeat({ while: (exists) => !exists, schedule: Schedule.spaced(5) }));
    const pid = Number(yield* files.readFileString(pidfile));
    if (!Number.isInteger(pid) || pid <= 0) return yield* unavailable('the isolated holder reported no process identity');
    let exitCode: number | null = null;
    const exited = Effect.gen(function* () {
      yield* failure;
      if (!(yield* files.exists(exitfile))) return undefined;
      exitCode = Number(yield* files.readFileString(exitfile));
      return exitCode;
    }).pipe(
      Effect.repeat({ while: (code) => code === undefined, schedule: Schedule.spaced(5) }),
      Effect.map((code) => code!),
    );
    const kill = Effect.gen(function* () {
      if (yield* files.exists(exitfile)) return;
      if (sockets.symbols.kill(pid, constants.signals.SIGKILL) !== 0 && errno() !== constants.errno.ESRCH)
        return yield* unavailable(`the isolated holder could not be ended: ${errno()}`);
    });
    yield* Effect.addFinalizer(() => Effect.andThen(kill, exited).pipe(Effect.orDie));
    const process: FixtureProcess & { readonly fd: number; readonly disconnect: Effect.Effect<void> } = {
      fd,
      disconnect,
      exited: exited.pipe(Effect.mapError(failed)),
      exitCode: () => exitCode,
      kill: kill.pipe(Effect.mapError(failed)),
    };
    return process;
  },
  (effect) => effect.pipe(Effect.mapError(failed)),
);
