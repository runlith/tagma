import { userInfo } from 'node:os';
import { expect } from 'bun:test';
import { layer } from '@runlith/effect-test';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Context, Data, Effect, FileSystem, Layer, Option, Schedule, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ExecutionRef, ExecutionId, InstallationId } from '@runlith/executions/protocol/execution';
import type { LaunchRequest, LaunchTransport } from '@runlith/executions/protocol/launch';
import { TRANSFER_LIMIT } from '@runlith/executions/protocol/capacity';
import { ProcessControl } from './ProcessControl';
import { Processes, type ProcessReader } from './ProcessReader';
import { makeExecutionInput } from './ExecutionInput';
import { admit, runtimeProfile } from './runtimeFixture';
import { Holder, HolderRefused } from './holder/Holder';
import { launchNative, type NativeSource } from './nativeLaunch';
import { loadLibrary, type LoadedLibrary } from './posix/Library';
import { HOLDER_BINARY, HOLDER_LIBRARY, testHolder } from './posix/testing/holder';
import { principalOf } from './hostFixture';
import { processReader } from './posix/macos/processes';
import { processControl } from './posix/control';
import { makeProcessTables } from './ProvenSet';
import { terminalFacts } from './posix/testing/terminal';
import { Descriptors } from './posix/native';

const ref = ExecutionRef.make({
  installation: InstallationId.make('native-launch'),
  execution: ExecutionId.make('native-launch-1'),
  incarnation: 1,
});
const named = (name: string): ExecutionRef => ({ ...ref, execution: ExecutionId.make(name) });
const bytesOf = (source: NativeSource, maximum = TRANSFER_LIMIT) =>
  Stream.unfold(undefined, () =>
    Effect.map(source.read(maximum), (chunk) => (chunk === undefined ? undefined : ([chunk, undefined] as const))),
  );
const textOf = (source: NativeSource) => Stream.runCollect(bytesOf(source)).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString()));
const launch = (transport: LaunchTransport, script = 'exit 0', program = '/bin/sh'): LaunchRequest => ({
  command: { program, args: ['-c', script], environment: [], cwd: '/' },
  transport,
  lifetime: 'call',
  purpose: 'command',
  target: { environment: 'test', namespace: 'test', cwd: '/', dependencies: [] },
  holder: principalOf('test-holder'),
  origin: principalOf('test-origin'),
});
const PIPES: LaunchTransport = { _tag: 'pipes', stdin: 'ignore' };
const TERMINAL: LaunchTransport = { _tag: 'pty', geometry: { rows: 24, columns: 80 } };
type NativeWorld = {
  readonly directory: string;
  readonly library: LoadedLibrary;
  readonly holder: Holder['Service'];
};
type NativeCase<A, E, R> = {
  readonly state?: string;
  readonly binary?: string;
  readonly use: (world: NativeWorld) => Effect.Effect<A, E, R>;
};
const nativeCase = Effect.fnUntraced(function* <A, E, R>({ state, binary = HOLDER_BINARY, use }: NativeCase<A, E, R>) {
  const files = yield* FileSystem.FileSystem;
  const directory = state ?? (yield* files.makeTempDirectoryScoped({ prefix: 'native-launch-' }));
  const context = yield* Layer.build(testHolder(directory, HOLDER_LIBRARY, binary));
  const library = yield* loadLibrary(HOLDER_LIBRARY);
  return yield* use({ directory, library, holder: Context.get(context, Holder) }).pipe(Effect.provide(context));
}, Effect.scoped);
class FixtureFailed extends Data.TaggedError('FixtureFailed')<{ readonly message: string }> {}
const failed = (cause: unknown) => new FixtureFailed({ message: String(cause) });
const command = Effect.fnUntraced(function* (argv: readonly [string, ...string[]]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(argv[0], argv.slice(1), { stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' }));
  const stdout = yield* Stream.runCollect(child.stdout).pipe(Effect.map((chunks) => Buffer.concat(chunks).toString()));
  expect(Number(yield* child.exitCode)).toBe(0);
  return stdout.trim();
}, Effect.scoped);
const fillTerminal = Effect.fnUntraced(function* (native: Effect.Success<ReturnType<typeof launchNative>>) {
  const terminal = native.held.channels._tag === 'pty' ? native.held.channels.terminal : undefined;
  if (terminal === undefined) return yield* new FixtureFailed({ message: 'the launch provided no terminal' });
  const bytes = new Uint8Array(65536).fill(120);
  let blocked = false;
  for (let attempt = 0; attempt < 16 && !blocked; attempt++)
    blocked = Option.isNone(yield* terminal.write(bytes).pipe(Effect.timeoutOption(25)));
  expect(blocked).toBe(true);
  return terminal;
});
const through = Effect.fnUntraced(function* (source: NativeSource, marker: string, maximum = TRANSFER_LIMIT) {
  let text = '';
  yield* Stream.runDrain(
    Stream.takeUntil(bytesOf(source, maximum), (bytes) => {
      text += new TextDecoder().decode(bytes);
      return text.includes(marker);
    }),
  );
  return text;
});

layer(BunServices.layer, { excludeTestServices: true })('native launch contracts', (it) => {
  it.effect('uses only the supplied HOME and PATH and refuses invalid inputs at spawn', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(PIPES);
        for (const command of [
          { ...base.command, cwd: undefined, environment: [{ name: 'HOME', value: '/not-a-home-directory' }] },
          { ...base.command, cwd: '/bin/sh' },
          { ...base.command, cwd: 'relative' },
          { ...base.command, program: 'sh' },
          { ...base.command, environment: [{ name: 'BAD=NAME', value: 'value' }] },
          { ...base.command, environment: [{ name: 'BAD', value: '\0' }] },
        ])
          expect((yield* Effect.flip(launchNative({ ...base, command }, ref, holder))).stage).toBe('spawn');
        const home = yield* launchNative(
          {
            ...base,
            command: {
              program: 'pwd',
              args: [],
              environment: [
                { name: 'HOME', value: '/usr' },
                { name: 'PATH', value: '../bin' },
              ],
            },
          },
          named('home-path'),
          holder,
        );
        expect(yield* textOf(home.sources[0]!)).toBe('/usr\n');
        yield* home.exit;
        yield* home.target.end('destroy', undefined, 'stopping');
        const exact = yield* launchNative(
          { ...base, transport: TERMINAL, command: { program: '/usr/bin/env', args: [], cwd: '/', environment: [] } },
          named('exact-env'),
          holder,
        );
        expect(yield* textOf(exact.sources[0]!)).toBe('');
        yield* exact.exit;
        yield* exact.target.end('destroy', undefined, 'stopping');
        const fallback = yield* launchNative(
          { ...base, command: { program: '/bin/pwd', args: [], environment: [] } },
          named('user-home'),
          holder,
        );
        expect(yield* textOf(fallback.sources[0]!)).toBe(`${userInfo().homedir}\n`);
        yield* fallback.exit;
        yield* fallback.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect(
    'preserves DYLD and large environment values after the source image is removed',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'native-image-' });
      const binary = `${state}/holder-source`;
      yield* files.copyFile(HOLDER_BINARY, binary);
      const expected = { DYLD_PROBE: 'kept exactly', LARGE: 'x'.repeat(131072) };
      yield* nativeCase({
        state,
        binary,
        use: Effect.fnUntraced(function* ({ holder }) {
          yield* files.remove(binary);
          for (const transport of [PIPES, TERMINAL]) {
            const base = launch(transport);
            const native = yield* launchNative(
              {
                ...base,
                command: {
                  program: process.execPath,
                  args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
                  cwd: '/',
                  environment: Object.entries(expected).map(([name, value]) => ({ name, value })),
                },
              },
              named(`dyld-${transport._tag}`),
              holder,
            );
            expect(
              yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))(
                yield* textOf(native.sources[0]!),
              ),
            ).toEqual(expected);
            yield* native.exit;
            yield* native.target.end('destroy', undefined, 'stopping');
          }
        }),
      });
    }),
  );
  it.effect(
    'launches when the image directory is unwritable',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'native-unwritable-image-' });
      const images = `${state}/launch-images`;
      yield* files.makeDirectory(images, { mode: 0o500 });
      yield* Effect.addFinalizer(() => files.chmod(images, 0o700).pipe(Effect.orDie));
      yield* nativeCase({
        state,
        use: Effect.fnUntraced(function* ({ holder }) {
          const native = yield* launchNative(launch(TERMINAL, 'printf fallback'), ref, holder);
          expect(yield* textOf(native.sources[0]!)).toBe('fallback');
          yield* native.exit;
          yield* native.target.end('destroy', undefined, 'stopping');
        }),
      });
    }),
  );
  it.effect(
    'repairs a damaged saved image before launching with the removed source',
    Effect.fnUntraced(function* () {
      const files = yield* FileSystem.FileSystem;
      const state = yield* files.makeTempDirectoryScoped({ prefix: 'native-damaged-image-' });
      const binary = `${state}/holder-source`;
      yield* files.copyFile(HOLDER_BINARY, binary);
      yield* nativeCase({ state, binary, use: ({ holder }) => holder.ready });
      const image = (yield* files.readDirectory(`${state}/launch-images`)).find((name) => /^[0-9a-f]{64}$/.test(name));
      if (image === undefined) return yield* new FixtureFailed({ message: 'the holder saved no launch image' });
      yield* files.writeFileString(`${state}/launch-images/${image}`, 'damaged');
      yield* nativeCase({
        state,
        binary,
        use: Effect.fnUntraced(function* ({ holder }) {
          yield* files.remove(binary);
          const native = yield* launchNative(launch(PIPES, 'printf repaired'), ref, holder);
          expect(yield* textOf(native.sources[0]!)).toBe('repaired');
          yield* native.exit;
          yield* native.target.end('destroy', undefined, 'stopping');
        }),
      });
    }),
  );
  it.effect(
    'refuses a truncated startup environment without executing the program',
    Effect.fnUntraced(function* () {
      const native = yield* Effect.acquireRelease(Effect.try({ try: () => Descriptors.load(HOLDER_LIBRARY), catch: failed }), (loaded) =>
        Effect.sync(() => loaded.unload()),
      );
      const pair = native.pair();
      if (!('ends' in pair)) return yield* failed(pair.detail);
      const [writer, reader] = pair.ends;
      const owned = new Set(pair.ends);
      const close = (fd: number) => {
        if (owned.delete(fd)) native.close(fd);
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const fd of [...owned]) close(fd);
        }),
      );
      const script = `import os\nos.setsid()\nos.dup2(0,4,inheritable=True)\nos.execv(${JSON.stringify(HOLDER_BINARY)},[${JSON.stringify(HOLDER_BINARY)},"--launch","pipes","256","/bin/sh","/bin/sh","-c","printf launched"])`;
      const child = yield* Effect.acquireRelease(
        Effect.try({
          try: () => Bun.spawn(['/usr/bin/python3', '-c', script], { stdin: reader, stdout: 'pipe', stderr: 'inherit' }),
          catch: failed,
        }),
        (child) =>
          Effect.gen(function* () {
            if (child.exitCode === null) child.kill('SIGKILL');
            yield* Effect.promise(() => child.exited);
          }),
      );
      close(reader);
      const prefix = Buffer.alloc(8);
      prefix.writeBigUInt64LE(32n);
      const wrote = native.write(writer, Buffer.concat([prefix, Buffer.from('HOME=/\0')]));
      if (!('count' in wrote)) return yield* failed(wrote.detail);
      close(writer);
      const output = yield* Effect.tryPromise({ try: () => new Response(child.stdout).text(), catch: failed });
      expect(yield* Effect.promise(() => child.exited)).not.toBe(0);
      expect(output).toBe('');
    }),
  );
  it.effect('preserves the inherited soft descriptor limit on both transports', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const inherited = Number(yield* command(['/bin/sh', '-c', 'ulimit -n']));
        for (const transport of [PIPES, TERMINAL]) {
          const native = yield* launchNative(launch(transport, 'ulimit -n'), named(`limit-${transport._tag}`), holder);
          expect(Number((yield* textOf(native.sources[0]!)).trim())).toBe(inherited);
          yield* native.exit;
          yield* native.target.end('destroy', undefined, 'stopping');
        }
      }),
    }),
  );
  it.effect('closes output descriptors at EOF while unreaped input remains owned', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder, library }) {
        const descriptors = Effect.suspend(() => {
          const logic = library.abi.descriptors(process.pid);
          const held = library.abi.descriptors(holder.pid);
          if ('refusal' in logic) return failed(logic.detail);
          if ('refusal' in held) return failed(held.detail);
          return Effect.succeed({ logic: logic.count, holder: held.count });
        });
        const before = yield* descriptors;
        const native = yield* launchNative(launch({ _tag: 'pipes', stdin: 'pipe' }, 'read line; printf "%s" "$line"'), ref, holder);
        yield* native.sink.write(new TextEncoder().encode('kept\n'));
        const collected = yield* Effect.forEach(native.sources, textOf, { concurrency: 2 });
        yield* native.exit;
        const after = yield* descriptors;
        expect(collected[0]).toBe('kept');
        expect(native.held.reaped).toBeUndefined();
        expect(after.holder - before.holder).toBe(1);
        expect(after.logic - before.logic).toBe(1);
      }),
    }),
  );
  it.effect('refuses running release without losing input and retains exit and cost through idempotent release', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const native = yield* launchNative(launch({ _tag: 'pipes', stdin: 'pipe' }, 'read line; printf "%s" "$line"; exit 7'), ref, holder);
        expect((yield* Effect.flip(native.held.release)).reason).toBe('running');
        yield* native.sink.write(new TextEncoder().encode('kept\n'));
        expect(yield* textOf(native.sources[0]!)).toBe('kept');
        expect(yield* native.held.observe).toEqual({ _tag: 'Code', code: 7 });
        const first = yield* native.held.reap;
        expect(yield* native.held.reap).toEqual(first);
        yield* native.held.release;
        yield* native.held.release;
        expect(yield* native.held.exit).toEqual({ _tag: 'Code', code: 7 });
        expect(first.cost._tag).toBe('Measured');
      }),
    }),
  );
  it.effect('accepts pipe input after leader exit while a child reads, then reports closed', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch({ _tag: 'pipes', stdin: 'pipe' });
        const native = yield* launchNative(
          { ...base, command: { ...base.command, program: '/usr/bin/perl', args: ['-e', 'if(fork()){exit}; read(STDIN,$b,4); print $b'] } },
          ref,
          holder,
        );
        yield* native.exit;
        yield* native.sink.write(new TextEncoder().encode('kept'));
        expect(yield* textOf(native.sources[0]!)).toBe('kept');
        expect((yield* Effect.flip(native.sink.write(new TextEncoder().encode('late')))).reason).toBe('closed');
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('preserves argv, environment, cwd, pid, parentage and birth through terminal attach', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ library, holder }) {
        const held = yield* holder.launch({
          id: 'attach-identity',
          path: '/bin/sh',
          argv: ['asked-name', '-c', 'printf "%s:%s:%s:%s\\n" "$0" "$$" "$HOME" "$PWD"; exec sleep 20'],
          env: [{ name: 'HOME', value: '/usr' }],
          cwd: '/',
          transport: TERMINAL,
          pace: 'full',
        });
        if (held.channels._tag !== 'pty' || held.channels.terminal === undefined) return yield* failed('no terminal');
        const bytes = yield* held.channels.terminal.read();
        expect((yield* processReader(library)).identity(held.pid)).toMatchObject({
          _tag: 'Read',
          parent: holder.pid,
          work: held.work,
          pid: held.pid,
          birth: held.birth,
        });
        expect(new TextDecoder().decode(bytes)).toContain(`asked-name:${held.pid}:/usr:/`);
        yield* held.act('work', 'kill');
        yield* held.exit;
        yield* held.reap;
        yield* held.release;
        expect(held.pid).toBe(held.work);
      }),
    }),
  );
  it.effect('keeps SIGPIPE at its default disposition through terminal attach', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(TERMINAL);
        const native = yield* launchNative(
          {
            ...base,
            command: {
              ...base.command,
              program: '/usr/bin/perl',
              args: ['-e', 'pipe(my $r,my $w) or die; close $r; syswrite($w,"x"); exit 37'],
            },
          },
          ref,
          holder,
        );
        const exit = yield* native.exit;
        expect(exit).toEqual({ _tag: 'Signal', signal: 'SIGPIPE' });
        yield* native.target.end('destroy', exit, 'stopping');
      }),
    }),
  );
  it.effect('refuses terminal input after leader exit even with an inherited slave', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(TERMINAL);
        const native = yield* launchNative(
          {
            ...base,
            command: {
              ...base.command,
              program: '/usr/bin/perl',
              args: ['-e', '$SIG{HUP}="IGNORE"; system("/bin/stty","-echo","-icanon"); if(fork()){exit}; read(STDIN,$b,4); print $b'],
            },
          },
          ref,
          holder,
        );
        yield* native.exit;
        expect((yield* Effect.flip(native.sink.write(new TextEncoder().encode('late')))).reason).toBe('closed');
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('delivers resize and Ctrl-C with a full input buffer while preserving control echo and queued bytes', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(TERMINAL);
        const script = `import os,signal,termios
a=termios.tcgetattr(0); a[3]=(a[3]&~(termios.ICANON|termios.ECHO))|termios.ISIG; termios.tcsetattr(0,termios.TCSANOW,a)
def resized(*_):
 os.write(1,b"resized\\nABC")
 a=termios.tcgetattr(0); a[3]|=termios.ECHO|termios.ECHOCTL|termios.NOFLSH; termios.tcsetattr(0,termios.TCSANOW,a)
def interrupted(*_):
 os.write(1,b"interrupted\\n")
 os.write(1,b"kept:"+os.read(0,1)+b"\\n")
signal.signal(signal.SIGWINCH,resized)
signal.signal(signal.SIGINT,interrupted)
os.write(1,b"ready\\n")
while True: signal.pause()`;
        const native = yield* launchNative(
          { ...base, command: { ...base.command, program: '/usr/bin/python3', args: ['-c', script] } },
          ref,
          holder,
        );
        yield* through(native.sources[0]!, 'ready');
        yield* fillTerminal(native);
        const limits = runtimeProfile({ inputPendingBytes: 65536 }).execution;
        const input = yield* makeExecutionInput({ sink: native.sink, limits, ref, announce: Effect.void });
        expect(
          (yield* admit(input, {
            sequence: 0,
            cause: 'typed',
            act: { _tag: 'Write', bytes: new Uint8Array(limits.input.chunkBytes).fill(121) },
          }))._tag,
        ).toBe('InputAdmitted');
        yield* Effect.yieldNow;
        expect(
          (yield* admit(input, { sequence: 1, cause: 'resize', act: { _tag: 'Resize', geometry: { rows: 12, columns: 40 } } }))._tag,
        ).toBe('InputAdmitted');
        yield* terminalFacts(native.held).pipe(Effect.repeat({ until: (facts) => facts.echo, schedule: Schedule.spaced('5 millis') }));
        const interrupt = yield* admit(input, { sequence: 2, cause: 'interrupt', act: { _tag: 'Interrupt' } });
        expect(interrupt._tag === 'InputAdmitted' ? interrupt.receipt.bytes : undefined).toBe(1);
        const seen = yield* through(native.sources[0]!, 'kept:x');
        expect(seen).toContain('ABC^C');
        expect(seen).toContain('resized');
        expect(seen).toContain('interrupted');
        expect(seen).toContain('kept:x');
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('abandons queued paste when Ctrl-C flushes a full input buffer', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(TERMINAL);
        const script = `import os,signal,termios
a=termios.tcgetattr(0); a[3]=(a[3]&~(termios.ICANON|termios.ECHO|termios.NOFLSH))|termios.ISIG; termios.tcsetattr(0,termios.TCSANOW,a)
def interrupted(*_):
 os.write(1,b"interrupted\\n")
 os.write(1,b"seen:"+os.read(0,4096)+b"\\n")
signal.signal(signal.SIGINT,interrupted)
os.write(1,b"ready\\n")
while True: signal.pause()`;
        const native = yield* launchNative(
          { ...base, command: { ...base.command, program: '/usr/bin/python3', args: ['-c', script] } },
          ref,
          holder,
        );
        yield* through(native.sources[0]!, 'ready');
        yield* fillTerminal(native);
        const limits = runtimeProfile({ inputPendingBytes: 65536 }).execution;
        const input = yield* makeExecutionInput({ sink: native.sink, limits, ref, announce: Effect.void });
        for (let sequence = 0; sequence < 2; sequence++) {
          expect(
            (yield* admit(input, {
              sequence,
              cause: 'typed',
              act: { _tag: 'Write', bytes: new Uint8Array(limits.input.chunkBytes).fill(121) },
            }))._tag,
          ).toBe('InputAdmitted');
          yield* Effect.yieldNow;
        }
        expect((yield* admit(input, { sequence: 2, cause: 'interrupt', act: { _tag: 'Interrupt' } }))._tag).toBe('InputAdmitted');
        expect((yield* admit(input, { sequence: 3, cause: 'typed', act: { _tag: 'Write', bytes: Buffer.from('fresh') } }))._tag).toBe(
          'InputAdmitted',
        );
        expect(yield* through(native.sources[0]!, 'seen:fresh')).toContain('seen:fresh');
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('keeps control echo and SIGINT when terminal input has room', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const base = launch(TERMINAL);
        const script =
          'import os,signal,termios\na=termios.tcgetattr(0); a[3]=(a[3]&~termios.ICANON)|termios.ISIG|termios.ECHO|termios.ECHOCTL; termios.tcsetattr(0,termios.TCSANOW,a)\nsignal.signal(signal.SIGINT,lambda *_:os.write(1,b"interrupted\\n"))\nos.write(1,b"ready\\n")\nwhile True: signal.pause()';
        const native = yield* launchNative(
          { ...base, command: { ...base.command, program: '/usr/bin/python3', args: ['-c', script] } },
          ref,
          holder,
        );
        yield* through(native.sources[0]!, 'ready');
        yield* native.sink.interrupt();
        const seen = yield* through(native.sources[0]!, 'interrupted');
        expect(seen).toContain('^C');
        expect(seen).toContain('interrupted');
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('keeps raw control echo without ECHOCTL and suppresses echo under EXTPROC', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        for (const mode of ['raw', 'external']) {
          const base = launch(TERMINAL);
          const script = `import os,signal,termios,sys,fcntl,struct
a=termios.tcgetattr(0); a[3]=(a[3]&~(termios.ICANON|termios.ECHO))|termios.ISIG|termios.NOFLSH; termios.tcsetattr(0,termios.TCSANOW,a)
def resized(*_):
 os.write(1,b"ABC")
 a=termios.tcgetattr(0); a[3]=(a[3]|termios.ECHO)&~termios.ECHOCTL
 if sys.argv[1]=="external": a[3]|=termios.ECHOCTL
 termios.tcsetattr(0,termios.TCSANOW,a)
 if sys.argv[1]=="external": fcntl.ioctl(0,0x80047460,struct.pack("i",1))
signal.signal(signal.SIGWINCH,resized)
signal.signal(signal.SIGINT,lambda *_:os.write(1,b"DONE\\n"))
os.write(1,b"ready\\n")
while True: signal.pause()`;
          const native = yield* launchNative(
            { ...base, command: { ...base.command, program: '/usr/bin/python3', args: ['-c', script, mode] } },
            named(`echo-${mode}`),
            holder,
          );
          yield* through(native.sources[0]!, 'ready');
          const terminal = yield* fillTerminal(native);
          yield* terminal.resize(12, 40);
          yield* terminalFacts(native.held).pipe(
            Effect.repeat({
              until: (facts) => facts.echo && facts.external === (mode === 'external'),
              schedule: Schedule.spaced('5 millis'),
            }),
          );
          yield* terminal.interrupt();
          expect(yield* through(native.sources[0]!, 'DONE\r\n', 1)).toBe(mode === 'raw' ? 'ABC\u0003DONE\r\n' : 'ABCDONE\r\n');
          yield* native.target.end('destroy', undefined, 'stopping');
        }
      }),
    }),
  );
  it.effect('refuses interrupt with ISIG disabled without closing ordinary input', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const native = yield* launchNative(launch(TERMINAL, 'stty -echo -isig; echo ready; read line; printf "%s" "$line"'), ref, holder);
        yield* through(native.sources[0]!, 'ready');
        expect(yield* Effect.flip(native.sink.interrupt())).toMatchObject({ _tag: 'InputActUnsupported', reason: 'isig-disabled' });
        yield* native.sink.write(new TextEncoder().encode('kept\n'));
        expect(yield* textOf(native.sources[0]!)).toBe('kept');
        yield* native.exit;
        yield* native.target.end('destroy', undefined, 'stopping');
      }),
    }),
  );
  it.effect('refuses a missing program at spawn on pipes and at each terminal pace', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        for (const transport of [PIPES, TERMINAL])
          for (const pace of ['full', 'low', 'lowest'] as const) {
            const refused = yield* Effect.flip(launchNative(launch(transport, 'exit 0', '/no/such/program'), ref, holder, undefined, pace));
            expect(refused).toMatchObject({ _tag: 'NativeSpawnRefused', transport: transport._tag, stage: 'spawn' });
          }
      }),
    }),
  );
  it.effect('launches the terminal and its child at the requested full or utility pace', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const own = yield* command(['ps', '-o', 'pri=', '-p', String(process.pid)]);
        for (const pace of ['full', 'low'] as const) {
          const native = yield* launchNative(
            launch(TERMINAL, 'sleep 30 & echo ready; wait'),
            named(`pace-${pace}`),
            holder,
            undefined,
            pace,
          );
          yield* through(native.sources[0]!, 'ready');
          const pid = native.identity.pid;
          const leader = yield* command(['ps', '-o', 'pri=,comm=', '-p', String(pid)]);
          const child = (yield* command(['pgrep', '-P', String(pid)])).split('\n')[0];
          if (child === undefined) return yield* failed('the terminal started no child');
          const priority = yield* command(['ps', '-o', 'pri=', '-p', child]);
          expect({ pace: native.pace, leader, child: priority }).toEqual(
            pace === 'full' ? { pace: 'full', leader: `${own} /bin/sh`, child: own } : { pace: 'low', leader: '20 /bin/sh', child: '20' },
          );
          yield* native.target.end('destroy', undefined, 'stopping');
        }
      }),
    }),
  );
  it.effect('destroys retained work after leader exit while reporting its original exit and measured cost', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder }) {
        const native = yield* launchNative(launch(PIPES, 'sleep 31 >/dev/null 2>&1 & exit 0'), ref, holder);
        yield* native.exit;
        const ending = yield* native.target.end('destroy', undefined, 'stopping');
        expect(ending.exit).toEqual({ _tag: 'Code', code: 0 });
        expect(ending.steps).toEqual(['terminate']);
        expect(ending.confirmed.map((resource) => [resource.relation, resource.step])).toEqual([
          ['leader', 'unsignalled'],
          ['work', 'terminate'],
        ]);
        expect(ending.residual).toEqual([]);
        expect(ending.cost._tag).toBe('Measured');
      }),
    }),
  );
  it.effect('sweeps proven ancestry even when the leader cannot be observed', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder: real, library }) {
        const processes = yield* processReader(library);
        const control = yield* ProcessControl;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        let leader = 0;
        let escapedPid = 0;
        const table = Effect.sync(() => {
          const own = processes.identity(leader);
          const child = processes.identity(escapedPid);
          return own._tag === 'Read' ? [own, ...(child._tag === 'Read' ? [{ ...child, parent: leader }] : [])] : [];
        });
        const strays: ProcessReader = {
          ...processes,
          table,
          members: (work) => Effect.map(table, (rows) => rows.filter((row) => row.work === work)),
          facts: (pids) =>
            Effect.succeed({
              processes: [],
              unread: pids.filter((pid) => pid !== escapedPid).map((pid) => ({ pid, _tag: 'Gone' as const })),
            }),
        };
        const holder = Holder.of({
          ...real,
          launch: (spec) =>
            Effect.map(real.launch(spec), (held) => ({
              ...held,
              get reaped() {
                return held.reaped;
              },
              exit: Effect.fail(new HolderRefused({ act: 'exit', reason: 'os', detail: 'waitid ECHILD (fault injection)' })),
              observe: Effect.fail(new HolderRefused({ act: 'observe', reason: 'os', detail: 'waitid ECHILD (fault injection)' })),
            })),
        });
        const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(
          Effect.provideService(Processes, strays),
          Effect.provideService(ProcessControl, processControl(strays)),
        );
        const native = yield* launchNative(launch(PIPES, 'trap "" INT; printf armed; exec sleep 30'), ref, holder, tables);
        yield* through(native.sources[0]!, 'armed');
        leader = native.identity.pid ?? 0;
        const child = yield* spawner.spawn(
          ChildProcess.make('/usr/bin/perl', ['-e', '$SIG{INT}="IGNORE"; $|=1; print "armed\\n"; sleep 30'], {
            stdin: 'ignore',
            stdout: 'pipe',
            stderr: 'inherit',
          }),
        );
        const ready = yield* Stream.runHead(Stream.splitLines(Stream.decodeText(child.stdout)));
        expect(ready).toEqual(Option.some('armed'));
        escapedPid = child.pid;
        const escaped = processes.identity(escapedPid);
        if (escaped._tag !== 'Read') return yield* failed('the escaped process has no witness');
        const ending = yield* native.target.end('destroy', undefined, 'stopping');
        expect(ending.exit).toBeUndefined();
        expect(ending.unverifiable.some((resource) => resource.kind === 'process')).toBe(true);
        expect(ending.measured).toEqual(['ancestry']);
        expect(ending.residual).toEqual([]);
        expect(ending.steps).toEqual(['interrupt', 'terminate']);
        yield* child.isRunning.pipe(Effect.repeat({ until: (running) => !running, schedule: Schedule.spaced('5 millis') }));
        expect(yield* control.standing(escaped)).toBe('gone');
      }),
    }),
  );
  it.effect('does not signal detached proven work when its leader finishes naturally', () =>
    nativeCase({
      use: Effect.fnUntraced(function* ({ holder, library }) {
        const processes = yield* processReader(library);
        const control = yield* ProcessControl;
        const tables = yield* makeProcessTables({ gapMs: 0 }).pipe(Effect.provideService(Processes, processes));
        const native = yield* launchNative(
          launch(
            { _tag: 'pipes', stdin: 'pipe' },
            'perl -e "use POSIX; POSIX::setsid(); exec(q{sleep}, q{30})" >/dev/null 2>&1 & printf "%s\\n" "$!"; read line',
          ),
          ref,
          holder,
          tables,
        );
        const pid = yield* Schema.decodeUnknownEffect(Schema.NumberFromString)((yield* through(native.sources[0]!, '\n')).trim());
        const escaped = processes.identity(pid);
        if (escaped._tag !== 'Read' || escaped.birth === undefined) return yield* failed('the detached child has no witness');
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            const sent = yield* control.signal(escaped, 'SIGKILL');
            if (sent !== 'delivered' && sent !== 'gone' && sent !== 'changed')
              return yield* Effect.die(new Error(`detached cleanup: ${sent}`));
            yield* control
              .standing(escaped)
              .pipe(Effect.repeat({ until: (state) => state === 'gone' || state === 'changed', schedule: Schedule.spaced('5 millis') }));
          }),
        );
        const set = native.proven;
        if (set === undefined) return yield* failed('the native execution has no proven set');
        yield* set.grow(yield* tables.read());
        expect((yield* set.members).some((member) => member.pid === pid)).toBe(true);
        yield* Effect.sync(() => processes.identity(pid)).pipe(
          Effect.repeat({
            until: (read) => read._tag === 'Read' && read.birth === escaped.birth && read.work === pid,
            schedule: Schedule.spaced('5 millis'),
          }),
        );
        yield* native.sink.write(new TextEncoder().encode('\n'));
        const exit = yield* native.exit;
        const ending = yield* native.target.end('signal', exit, 'ended');
        expect(yield* control.standing(escaped)).toBe('standing');
        expect(ending.measured.includes('ancestry')).toBe(false);
        expect((yield* set.reading).watched).toBe(false);
      }),
    }),
  );
});
