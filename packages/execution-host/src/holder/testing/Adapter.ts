import { Context, Effect } from 'effect';
import type { LaunchTransport } from '@runlith/executions/protocol/launch';
import type { Pace } from '@runlith/executions/protocol/pace';
import type { NativeExit } from '@runlith/executions/protocol/execution';
import { Holder, type HeldExecution, type HeldLaunch, type Readable, type Terminal, type Writable } from '../Holder';

export type Scenario =
  | 'geometry'
  | 'echo'
  | 'cat'
  | 'output'
  | 'alternate'
  | 'resize'
  | 'no-isig'
  | 'foreground'
  | 'orphan-input'
  | 'orphan-terminal'
  | 'closed-input'
  | 'split-output'
  | 'flood'
  | 'wait'
  | 'fork'
  | 'interrupt'
  | 'terminate'
  | 'stubborn'
  | 'handles'
  | 'limits'
  | 'cost';

export type Command = {
  readonly path: string;
  readonly args: ReadonlyArray<string>;
};

export class Adapter extends Context.Service<
  Adapter,
  {
    readonly exits: {
      readonly hangup: NativeExit;
      readonly interrupt: NativeExit;
      readonly terminate: NativeExit;
      readonly kill: NativeExit;
    };
    readonly directory: string;
    readonly home: string;
    readonly userHome: string;
    readonly file: string;
    readonly missing: string;
    readonly environment: Command;
    readonly cwd: Command;
    readonly pathName: string;
    readonly searchPath: string;
    readonly relativeSearchPath: string;
    readonly fixture: (scenario: Scenario, transport: LaunchTransport, size?: number) => Command;
    readonly standing: (pid: number) => Effect.Effect<'running' | 'zombie' | 'gone', unknown>;
    readonly softLimits: Effect.Effect<string, unknown>;
    readonly descriptors: (holder: number) => Effect.Effect<{ readonly logic: number; readonly holder: number }, unknown>;
    readonly priority: (pid: number) => Effect.Effect<string, unknown>;
    readonly background: (pid: number) => Effect.Effect<boolean, unknown>;
    readonly priorities: (launcher: number) => Effect.Effect<Readonly<Record<Pace, string>>, unknown>;
  }
>()('@runlith/execution-host/holder/testing/Adapter') {}

let serial = 0;
export const launch = Effect.fnUntraced(function* (transport: LaunchTransport, scenario: Scenario, size?: number, pace: Pace = 'full') {
  const adapter = yield* Adapter;
  const holder = yield* Holder;
  const command = adapter.fixture(scenario, transport, size);
  return yield* holder.launch({
    id: `contract-${++serial}`,
    path: command.path,
    argv: [command.path, ...command.args],
    env: [
      { name: 'PATH', value: adapter.searchPath },
      { name: 'HOME', value: adapter.home },
      { name: 'TERM', value: 'xterm-256color' },
    ],
    cwd: adapter.directory,
    transport,
    pace,
  });
});

export const request = (adapter: Adapter['Service'], command: Command, transport: LaunchTransport): HeldLaunch => ({
  id: `contract-${++serial}`,
  path: command.path,
  argv: [command.path, ...command.args],
  env: [],
  cwd: adapter.directory,
  transport,
  pace: 'full',
});

export const terminal = (execution: HeldExecution): Terminal => {
  if (execution.channels._tag !== 'pty' || execution.channels.terminal === undefined) throw new Error('the execution has no terminal');
  return execution.channels.terminal;
};

export const pipes = (execution: HeldExecution) => {
  if (execution.channels._tag !== 'pipes') throw new Error('the execution has no pipes');
  return execution.channels;
};

export const writeAll = Effect.fn('holder.testing.writeAll')(function* (sink: Writable, value: Uint8Array | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let offset = 0;
  while (offset < bytes.length) {
    const written = yield* sink.write(bytes.subarray(offset));
    if (written <= 0) return yield* Effect.die(new Error('a nonempty write made no progress'));
    offset += written;
  }
});

export const readUntil = Effect.fn('holder.testing.readUntil')(function* (source: Readable, marker: string | ReadonlyArray<string>) {
  const needles = (typeof marker === 'string' ? [marker] : marker).map((value) => Buffer.from(value));
  const overlap = Math.max(...needles.map((needle) => needle.length)) - 1;
  const chunks: Uint8Array[] = [];
  let tail = Buffer.alloc(0);
  for (;;) {
    const chunk = yield* source.read();
    if (chunk === undefined) return Buffer.concat(chunks);
    chunks.push(chunk);
    const scan = Buffer.concat([tail, chunk]);
    if (needles.some((needle) => scan.includes(needle))) return Buffer.concat(chunks);
    tail = scan.subarray(Math.max(0, scan.length - overlap));
  }
});

export const drain = Effect.fn('holder.testing.drain')(function* (source: Readable) {
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = yield* source.read();
    if (chunk === undefined) return Buffer.concat(chunks);
    chunks.push(chunk);
  }
});
export const ready = (source: Readable) => readUntil(source, ['READY\n', 'READY\r\n']);
export const pty = (rows: number, columns: number): LaunchTransport => ({ _tag: 'pty', geometry: { rows, columns } });
export const PTY: LaunchTransport = pty(24, 80);
export const PIPES: LaunchTransport = { _tag: 'pipes', stdin: 'pipe' };

export const finished = Effect.fnUntraced(function* (execution: HeldExecution) {
  const exit = yield* execution.exit;
  const reaped = yield* execution.reap;
  return { exit, cost: reaped.cost };
});

export const cleanup = Effect.fnUntraced(function* (execution: HeldExecution) {
  if (execution.reaped === undefined) {
    yield* execution
      .act('work', 'kill')
      .pipe(
        Effect.catchTag('HolderRefused', (failure) =>
          failure.reason === 'reaped' || failure.reason === 'gone' ? Effect.void : Effect.fail(failure),
        ),
      );
    yield* execution.exit;
    yield* execution.reap;
  }
  yield* execution.release;
});

export const using = <A, E, R>(execution: HeldExecution, body: Effect.Effect<A, E, R>) =>
  body.pipe(Effect.ensuring(Effect.orDie(cleanup(execution))));
