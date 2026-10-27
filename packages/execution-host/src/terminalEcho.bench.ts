import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, cpus, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duration, Effect } from 'effect';
import * as BunServices from '@effect/platform-bun/BunServices';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { endpointConnection } from '@runlith/executions/posix/endpoint';
import type { ExecutionRef } from '@runlith/executions/protocol/execution';
import { LANE_PATH, readOutputFrame } from '@runlith/executions/protocol/lane';
import type { LaunchRequest } from '@runlith/executions/protocol/launch';
import { keyOf, principalOf } from './hostFixture';
import { heldHost } from './posix/testing/holder';
import { benchBoot, benchClient, benchFlag } from './composition/testing/benchHost';

const KEYS = benchFlag('keys', 400);
const PRINTERS = benchFlag('printers', 4);
const BURNERS = benchFlag('burners', availableParallelism());
const WARMUP_MS = 3_000;
const LOAD_CAP = Duration.seconds(55);
const GAP_MS = 15;
const LINE_KEYS = 32;
const SETTLE_MS = 50;
const STARTUP_MS = 300;
const LETTERS = 'abcdefgijkmnopqrstuvwxyz';
const ERASE = '\u0015';
const SHELL_ENV = { PATH: '/usr/bin:/bin', TERM: 'xterm-256color', PS1: '' };
const PRINTER = 'my $line = ("x" x 79) . "\\n"; $| = 1; while (1) { print $line x 100; select(undef, undef, undef, 0.01) }';
const BURNER = '1 while 1';

type Lane = { readonly url: string; readonly token: string; readonly next: number };
type Stats = { readonly samples: number; readonly p50: number; readonly p99: number; readonly max: number };

const now = () => performance.now();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`);

const typist = () => {
  let text = '';
  let waiting: { readonly key: string; readonly from: number; readonly settle: (at: number) => void } | undefined;
  const heard = (chunk: string) => {
    const at = now();
    text += chunk;
    if (waiting === undefined || text.indexOf(waiting.key, waiting.from) < 0) return;
    const settled = waiting;
    waiting = undefined;
    settled.settle(at);
  };
  const type = async (write: (bytes: string) => void) => {
    const samples: number[] = [];
    for (let index = 0; index < KEYS; index += 1) {
      if (index % LINE_KEYS === 0) {
        write(ERASE);
        await sleep(SETTLE_MS);
      }
      const key = LETTERS[index % LETTERS.length]!;
      const echoed = new Promise<number>((settle) => {
        waiting = { key, from: text.length, settle };
      });
      const at = now();
      write(key);
      samples.push((await echoed) - at);
      await sleep(GAP_MS);
    }
    return samples;
  };
  return { heard, type };
};

const connect = (lane: Lane, frame: (bytes: Uint8Array) => void, closed: (code: number) => void): Promise<WebSocket> =>
  new Promise((ready) => {
    const socket = new WebSocket(lane.url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ lane: lane.token }));
    socket.onclose = (event) => closed(event.code);
    socket.onmessage = (event) => {
      if (typeof event.data !== 'string') {
        const read = readOutputFrame(new Uint8Array(event.data as ArrayBuffer));
        if (read !== undefined) frame(read.bytes);
        return;
      }
      const reply = JSON.parse(event.data) as { readonly t: string; readonly head?: string };
      if (reply.t !== 'ready') return;
      socket.send(JSON.stringify({ t: 'follow', offset: reply.head }));
      ready(socket);
    };
  });

const viaLane = async (lane: Lane) => {
  const { heard, type } = typist();
  const decoder = new TextDecoder();
  let typing = true;
  const socket = await connect(
    lane,
    (bytes) => heard(decoder.decode(bytes, { stream: true })),
    (code) => {
      if (!typing) return;
      say({ closed: code });
      process.exit(1);
    },
  );
  await sleep(SETTLE_MS);
  let sequence = lane.next;
  const samples = await type((bytes) =>
    socket.send(
      JSON.stringify({
        t: 'act',
        sequence: sequence++,
        cause: 'typed',
        act: { _tag: 'Write', bytes: Buffer.from(bytes).toString('base64') },
      }),
    ),
  );
  typing = false;
  socket.close(1000);
  return samples;
};

const viaPty = async () => {
  const { heard, type } = typist();
  const decoder = new TextDecoder();
  const shell = Bun.spawn(['/bin/sh'], {
    cwd: tmpdir(),
    env: SHELL_ENV,
    terminal: { cols: 80, rows: 24, data: (_terminal, bytes) => heard(decoder.decode(bytes, { stream: true })) },
  });
  const terminal = shell.terminal;
  if (terminal === undefined) throw new Error('Bun opened no terminal for the shell');
  await sleep(STARTUP_MS);
  const samples = await type((bytes) => terminal.write(bytes));
  shell.kill('SIGKILL');
  await shell.exited;
  terminal.close();
  return samples;
};

const follow = async (lanes: ReadonlyArray<Lane>) => {
  await Promise.all(
    lanes.map((lane) =>
      connect(
        lane,
        () => undefined,
        () => undefined,
      ),
    ),
  );
  await new Promise(() => undefined);
};

const lanesOf = (argv: ReadonlyArray<string>): Lane[] => {
  const lanes: Lane[] = [];
  for (let at = 0; at + 2 < argv.length; at += 3) lanes.push({ url: argv[at]!, token: argv[at + 1]!, next: Number(argv[at + 2]) });
  return lanes;
};

const statsOf = (samples: ReadonlyArray<number>): Stats => {
  const sorted = [...samples].sort((one, other) => one - other);
  const at = (share: number) => Math.round(100 * sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]!) / 100;
  return { samples: sorted.length, p50: at(0.5), p99: at(0.99), max: at(1) };
};

const sysctl = (name: string) => Bun.spawnSync(['/usr/sbin/sysctl', '-n', name]).stdout.toString().trim();

const machine = () => ({
  model: sysctl('hw.model'),
  cpu: cpus()[0]?.model,
  cores: availableParallelism(),
  performanceCores: Number(sysctl('hw.perflevel0.physicalcpu')),
  efficiencyCores: Number(sysctl('hw.perflevel1.physicalcpu')),
});

const client = (mode: string, lanes: ReadonlyArray<Lane>) =>
  Effect.promise(async () => {
    const argv = [
      process.execPath,
      import.meta.path,
      `--keys=${KEYS}`,
      mode,
      ...lanes.flatMap((lane) => [lane.url, lane.token, String(lane.next)]),
    ];
    const spawned = Bun.spawn(argv, {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const said = await new Response(spawned.stdout).text();
    if ((await spawned.exited) !== 0) throw new Error(`the ${mode} client failed: ${said}`);
    return statsOf(JSON.parse(said) as ReadonlyArray<number>);
  });

const running = (argv: ReadonlyArray<string>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.spawn([...argv], { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' })),
    (spawned) =>
      Effect.promise(async () => {
        spawned.kill('SIGKILL');
        await spawned.exited;
      }),
  );

const drive = Effect.fnUntraced(
  function* (directory: string) {
    const host = yield* benchClient(directory);
    yield* Effect.addFinalizer(() => Effect.ignore(host.shutdown(keyOf('bench-shutdown'))));
    const operator = principalOf('bench-operator');
    const start = Effect.fnUntraced(function* (name: string, command: LaunchRequest['command']) {
      const started = yield* host.start(keyOf(name), {
        command,
        transport: { _tag: 'pty', geometry: { rows: 24, columns: 80 } },
        lifetime: 'held',
        purpose: 'command',
        target: { environment: 'bench', namespace: 'bench', cwd: directory, dependencies: [] },
        holder: operator,
        origin: operator,
        budget: {},
      });
      if (started._tag !== 'Started') return yield* Effect.die(new Error(`${name} did not start: ${started._tag}`));
      const execution = started.execution;
      yield* Effect.addFinalizer(() => Effect.ignore(host.stop(keyOf(`${name}-stop`), execution, 'explicit-stop', 'signal')));
      return execution;
    });
    const lane = Effect.fnUntraced(function* (execution: ExecutionRef) {
      const bound = yield* host.openBinding(operator);
      if (bound._tag !== 'Bound') return yield* Effect.die(new Error(`no binding: ${bound._tag}`));
      const opened = yield* host.open(execution, { binding: bound.binding, principal: operator });
      return { url: `ws://127.0.0.1:${opened.port}${LANE_PATH}`, token: opened.token, next: opened.next } satisfies Lane;
    });
    const measure = Effect.fnUntraced(function* (execution: ExecutionRef) {
      const endpoint = yield* client('--lane', [yield* lane(execution)]);
      const direct = yield* client('--direct', []);
      return { endpoint, direct };
    });

    const shell = yield* start('echo-shell', {
      program: '/bin/sh',
      args: [],
      environment: Object.entries(SHELL_ENV).map(([name, value]) => ({ name, value })),
      cwd: directory,
    });
    yield* Effect.sleep(Duration.millis(STARTUP_MS));
    const loadBefore = loadavg()[0];
    const idle = yield* measure(shell);

    const saturated = yield* Effect.scoped(
      Effect.gen(function* () {
        const loadAtStart = loadavg()[0];
        const printing: ExecutionRef[] = [];
        for (let index = 0; index < PRINTERS; index += 1) {
          printing.push(
            yield* start(`echo-printer-${index}`, { program: '/usr/bin/perl', args: ['-e', PRINTER], environment: [], cwd: directory }),
          );
        }
        const followed = yield* Effect.forEach(printing, (execution) => lane(execution));
        yield* running([
          process.execPath,
          import.meta.path,
          '--follow',
          ...followed.flatMap((one) => [one.url, one.token, String(one.next)]),
        ]);
        for (let index = 0; index < BURNERS; index += 1) yield* running(['/usr/bin/perl', '-e', BURNER]);
        yield* Effect.sleep(Duration.millis(WARMUP_MS));
        const measured = yield* measure(shell);
        return { ...measured, loadAtStart, loadAtEnd: loadavg()[0] };
      }),
    ).pipe(Effect.timeout(LOAD_CAP));

    return {
      machine: machine(),
      load: { before: loadBefore, saturatedStart: saturated.loadAtStart, saturatedEnd: saturated.loadAtEnd },
      setup: { keys: KEYS, gapMs: GAP_MS, burners: BURNERS, printers: PRINTERS, warmupMs: WARMUP_MS },
      idle,
      saturated: { endpoint: saturated.endpoint, direct: saturated.direct },
    };
  },
  Effect.scoped,
  Effect.provide(HostRegistration.layer),
  Effect.provide(endpointConnection),
  Effect.provide(BunServices.layer),
);

const at = process.argv.findIndex((argument) => argument === '--lane' || argument === '--direct' || argument === '--follow');
const mode = at < 0 ? undefined : process.argv[at];
const rest = at < 0 ? [] : process.argv.slice(at + 1);
if (mode === '--lane') say(await viaLane(lanesOf(rest)[0]!));
else if (mode === '--direct') say(await viaPty());
else if (mode === '--follow') await follow(lanesOf(rest));
else {
  const directory = mkdtempSync(join(tmpdir(), 'terminal-echo-'));
  const holder = Bun.spawn(heldHost(join(import.meta.dir, 'main.ts'), benchBoot(directory)), {
    stdin: 'pipe',
    stdout: 'ignore',
    stderr: 'inherit',
  });
  try {
    console.log(JSON.stringify(await Effect.runPromise(drive(directory)), null, 2));
  } finally {
    holder.kill('SIGKILL');
    await holder.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}
