import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, cpus, hostname, loadavg, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { Cause, Clock, Duration, Effect, Fiber, Layer, Queue, Schema, Stream } from 'effect';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { performanceStoreWatchLayer } from '@runlith/performance/PerformanceStore';
import * as BunServices from '@effect/platform-bun/BunServices';
import * as ClientModule from '@runlith/executions/ExecutionClient';
import { ArtifactManifest, type ArtifactRole } from '@runlith/executions/protocol/artifact';
import type { InputInstruction } from '@runlith/executions/protocol/input';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { ExecutionPolicy } from '@runlith/executions/protocol/capacity';
import { Principal } from '@runlith/executions/protocol/custody';
import { HostRequestRef, type ExecutionRef } from '@runlith/executions/protocol/execution';
import type { LaunchCommand, LaunchRequest } from '@runlith/executions/protocol/launch';
import { byteOffset } from '@runlith/executions/protocol/record';
import { Registration } from '@runlith/executions/protocol/registration';
import { WireLimits } from '@runlith/executions/protocol/wire';

const option = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => {
  const value = option(name);
  if (value === undefined) throw new Error(`--${name}= is required`);
  return value;
};
const positive = (name: string, fallback: number) => {
  const value = Number(option(name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name}= must be a positive integer`);
  return value;
};
const bundle = resolve(required('bundle'));
const state = resolve(required('state'));
const repetitions = positive('repetitions', 3);
const bytes = positive('bytes', 8 * 1024 * 1024);
const echoes = positive('echoes', 40);
const starts = positive('starts', 30);
const shorts = positive('shorts', 10);
const metric = process.argv.includes('--prepare') ? 'prepare' : required('metric');
if (
  ![
    'prepare',
    'pty-output',
    'pty-echo',
    'pipe-stdout',
    'pipe-stdin',
    'pty-start',
    'pipe-start',
    'pty-short',
    'pipe-short',
    'input-spans',
  ].includes(metric)
)
  throw new Error('unknown metric');
const beganAt = new Date().toISOString();
const loadBefore = loadavg();
type TimedBytes = { readonly bytes: Uint8Array; readonly at: number };
type BenchInput = Extract<InputInstruction, { readonly _tag: 'Write' | 'End' }>;
type AdmissionTrace = {
  readonly traceId: string;
  readonly at: number;
  readonly frameMs: number;
  readonly queueMs: number;
  readonly admissionMs: number;
  readonly queuedReplyMs: number;
  readonly coveredMs: number;
  readonly sqlSpans: number;
};
type ShortObservation = { readonly received: string; readonly recorded: string; readonly delivered: boolean; readonly retained: boolean };
const now = Effect.map(Clock.monotonicTimeNanos, (at) => Number(at) / 1_000_000);
const Consumed = Schema.Struct({ bytes: Schema.Int, digest: Schema.String });
const principal = Schema.decodeUnknownSync(Principal)('io-bench');
const run = randomUUID();
const key = (operation: string) => Schema.decodeUnknownSync(HostRequestRef)({ installation: 'io-bench', operation: `${run}-${operation}` });
const registration = Schema.decodeUnknownSync(Registration)({
  version: 1,
  state,
  installation: 'io-bench',
  protocol: 'executions/1',
  endpoint: { transport: 'unix', path: join(state, 'host.sock') },
  credentials: { custodian: join(state, 'custodian'), recovery: join(state, 'recovery') },
});
const policy = Schema.decodeUnknownSync(ExecutionPolicy)({
  transports: ['pipes', 'pty'],
  relations: ['leader'],
  execution: {
    input: { pendingBytes: bytes, chunkBytes: 65536, receipts: 256 },
    output: { landingBytes: 16384, segmentBytes: 262144, retainedBytes: bytes * 2 },
    parser: { pendingBytes: 262144, cellBytes: 16 * 1024 * 1024 },
    geometry: { columns: 80, rows: 24, scrollbackRows: 100 },
    read: { chunkBytes: 65536, readerCredits: 262144, readers: 4 },
    frame: { bytes: 4 * 1024 * 1024, inFlight: 1 },
    receipts: 256,
  },
  host: { bindings: 256, custodyReceipts: 256, tombstones: 256 },
});
const limits = Schema.decodeUnknownSync(WireLimits)({
  frameBytes: 4 * 1024 * 1024 + 16384,
  headerBytes: 16384,
  connections: 3,
  requests: 3,
  subscriptions: 4,
  credits: 262144,
  helloMs: 5000,
});
const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(ArtifactManifest))(readFileSync(join(bundle, 'artifact.json'), 'utf8'));
const part = (role: ArtifactRole) => {
  const found = manifest.parts.find((candidate) => candidate.role === role);
  if (found === undefined) throw new Error(`bundle has no ${role}`);
  return join(bundle, found.path);
};
const runtime = part('runtime');
const chunk = Buffer.alloc(65536, 120);
for (let at = 79; at < chunk.length; at += 80) chunk[at] = 10;
const hash = createHash('sha256');
for (let at = 0; at < bytes; at += chunk.length) hash.update(chunk.subarray(0, Math.min(chunk.length, bytes - at)));
const digest = hash.digest('hex');
const writeScript = `import { writeSync } from 'node:fs'; const b=Buffer.alloc(65536,120); for(let i=79;i<b.length;i+=80)b[i]=10; console.log('READY'); for await(const input of Bun.stdin.stream()){ let left=${bytes}; while(left>0){const n=Math.min(left,b.length);let at=0;while(at<n)at+=writeSync(1,b,at,n-at);left-=n;} process.exit(0); }`;
const echoScript = `console.log('READY'); let n=0; for await(const b of Bun.stdin.stream()){n+=b.length;if(n>=${echoes + 10})process.exit(0);}`;
const readScript = `import {createHash} from 'node:crypto'; console.log('READY'); let n=0;const h=createHash('sha256');for await(const b of Bun.stdin.stream()){n+=b.length;h.update(b);}console.log(JSON.stringify({bytes:n,digest:h.digest('hex')}));`;
const shell = (script: string, echo: boolean) => [
  '-c',
  `stty -icanon ${echo ? 'echo' : '-echo'} -opost min 1 time 0; exec "$1" -e "$2"`,
  'io-bench',
  runtime,
  script,
];
const scriptCommand = (transport: 'pipes' | 'pty', script: string, echo = false): LaunchCommand => ({
  program: transport === 'pty' ? '/bin/sh' : runtime,
  args: transport === 'pty' ? shell(script, echo) : ['-e', script],
  environment: [
    { name: 'PATH', value: '/usr/bin:/bin' },
    { name: 'HOME', value: state },
  ],
});
const percentiles = (samples: number[]) => {
  const ordered = [...samples].sort((left, right) => left - right);
  const at = (fraction: number) => ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
  return { median: at(0.5), p95: at(0.95), min: ordered[0], max: ordered.at(-1) };
};
const selected = (name: string) => metric === name;

if (process.argv.includes('--prepare')) {
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const boot = join(state, 'boot.json');
  writeFileSync(
    boot,
    JSON.stringify({
      state,
      registration,
      library: part('platform'),
      policy,
      share: 0.25,
      limits,
      lifetime: 'with-parent',
      artifact: bundle,
    }),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      program: part('holder'),
      args: [state, runtime, part('host'), boot],
      boot,
    }),
  );
} else if (metric === 'input-spans') {
  const since = Date.parse(required('since'));
  if (!Number.isFinite(since)) throw new Error('--since= must name an instant');
  const evidence = await Effect.runPromise(
    PerformanceReports.use((reports) =>
      Effect.gen(function* () {
        const kept = yield* reports.read({ type: 'slow', name: 'admitInput', since, limit: 60 });
        if (kept.type !== 'slow' || kept.next !== null) return yield* Effect.die('admission reading is incomplete');
        const rows: AdmissionTrace[] = [];
        const missing: string[] = [];
        for (const admission of kept.spans.filter((span) => span.payload.attributes?.bytes === 65536)) {
          const trace = yield* reports.read({ type: 'trace', traceId: admission.traceId, limit: 32 });
          if (trace.type !== 'trace' || trace.next !== null) return yield* Effect.die('trace reading is incomplete');
          const spans = trace.segments.flatMap((segment) => segment.spans);
          const host = spans.find((span) => span.id === admission.parentId && span.name === 'Host.Input');
          const dispatch = spans.find((span) => span.id === host?.parentId && span.name === 'wire.read.dispatch');
          const frame = spans.find((span) => span.id === dispatch?.parentId && span.name === 'wire.framereader.take');
          if (host === undefined || dispatch === undefined || frame === undefined) {
            missing.push(admission.traceId);
            continue;
          }
          if ([host, dispatch, frame].some((span) => span.instanceId !== admission.instanceId))
            return yield* Effect.die('trace crosses clocks');
          rows.push({
            traceId: admission.traceId,
            at: admission.wallTime,
            frameMs: dispatch.monotonicEnd - frame.monotonicStart,
            queueMs: admission.monotonicStart - dispatch.monotonicEnd,
            admissionMs: admission.monotonicEnd - admission.monotonicStart,
            queuedReplyMs: host.monotonicEnd - admission.monotonicEnd,
            coveredMs: host.monotonicEnd - frame.monotonicStart,
            sqlSpans: spans.filter((span) => span.name === 'sql.execute' || span.name === 'sql.transaction').length,
          });
        }
        return {
          sample: true,
          since,
          build: manifest.identity,
          rows,
          missing,
          retainedRange: kept.retainedRange,
          coverage:
            'retained traces of 64 KiB writes through reply enqueue; excludes earlier socket chunks, actual socket send and client receipt',
          selection: 'all retained admissions in this window; retention favours slow and sampled traces, not an unbiased RPC population',
          distributions: {
            frameMs: percentiles(rows.map((row) => row.frameMs)),
            queueMs: percentiles(rows.map((row) => row.queueMs)),
            admissionMs: percentiles(rows.map((row) => row.admissionMs)),
            queuedReplyMs: percentiles(rows.map((row) => row.queuedReplyMs)),
            coveredMs: percentiles(rows.map((row) => row.coveredMs)),
          },
        };
      }),
    ).pipe(
      Effect.provide(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path: join(state, 'performance.sqlite') })))),
      Effect.timeout(Duration.seconds(50)),
    ),
  );
  console.log(JSON.stringify(evidence, null, 2));
  if (option('report') !== undefined) writeFileSync(resolve(required('report')), JSON.stringify(evidence, null, 2));
} else {
  const clientModule: typeof ClientModule = option('client') === undefined ? ClientModule : await import(resolve(required('client')));
  const measured = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* clientModule.ExecutionClient.make({
        address: { state, installation: registration.installation },
        role: 'custodian',
        limits,
      });
      const first = yield* client.take(key('take'), 0);
      const taken = first._tag === 'Stale' ? yield* client.take(key('take-standing'), first.standing.revision) : first;
      if (taken._tag !== 'Held') return yield* Effect.die(`take: ${JSON.stringify(taken)}`);
      const metrics: Record<string, unknown> = {};
      let ordinal = 0;
      const launch = Effect.fnUntraced(function* (transport: 'pipes' | 'pty', command: LaunchCommand) {
        ordinal += 1;
        const opened = yield* client.openBinding(principal);
        if (opened._tag !== 'Bound') return yield* Effect.die(`binding: ${JSON.stringify(opened)}`);
        const operation = key(`launch-${ordinal}`);
        const request: LaunchRequest = {
          command,
          transport: transport === 'pty' ? { _tag: 'pty', geometry: { columns: 80, rows: 24 } } : { _tag: 'pipes', stdin: 'pipe' },
          lifetime: 'call',
          purpose: 'command',
          target: { environment: 'bench', namespace: 'bench', cwd: state, dependencies: [] },
          holder: principal,
          origin: principal,
        };
        const began = yield* now;
        const started = yield* client.start(operation, request);
        if (started._tag !== 'Started') return yield* Effect.die(`start: ${JSON.stringify(started)}`);
        const ref: ExecutionRef = started.execution;
        const queue = yield* Queue.unbounded<TimedBytes, unknown>();
        let offset = 0n;
        const watcher = yield* Stream.runForEach(
          client.subscribe(
            {
              _tag: 'Bytes',
              cursor: {
                ref,
                stream: transport === 'pty' ? 'pty' : 'stdout',
                offset: byteOffset(0n),
              },
            },
            limits.credits,
          ),
          (delivery) =>
            Effect.gen(function* () {
              if (delivery._tag === 'Ended') {
                if (delivery.ending !== 'completed') return yield* Effect.die(`output ended: ${delivery.ending}`);
                yield* Queue.end(queue);
                return;
              }
              if (delivery._tag !== 'Bytes') return;
              if (delivery.range.gap || BigInt(delivery.range.cursor.offset) !== offset) return yield* Effect.die('output has a gap');
              offset = BigInt(delivery.range.next);
              if (delivery.bytes.length > 0) yield* Queue.offer(queue, { bytes: delivery.bytes, at: yield* now });
            }),
        ).pipe(
          Effect.onError((cause) => Queue.failCause(queue, cause)),
          Effect.forkScoped,
        );
        const ready = Effect.fnUntraced(function* () {
          let text = '';
          while (!text.endsWith('READY\n')) text += new TextDecoder().decode((yield* Queue.take(queue)).bytes);
        });
        let sequence = 0;
        const input = Effect.fnUntraced(function* (act: BenchInput) {
          const answer = yield* client.input(
            ref,
            { binding: opened.binding, principal },
            {
              sequence: sequence++,
              cause: act._tag === 'End' ? 'end' : 'raw',
              act,
            },
          );
          if (answer._tag !== 'InputAdmitted') return yield* Effect.die(`input: ${JSON.stringify(answer)}`);
        });
        const finish = Effect.fnUntraced(function* () {
          const ended = yield* Stream.runHead(
            Stream.filter(
              client.subscribe({ _tag: 'State', execution: ref }, limits.credits),
              (delivery) => delivery._tag === 'State' && delivery.summary.state.phase === 'ended',
            ),
          );
          if (ended?._tag !== 'Some' || ended.value._tag !== 'State') return yield* Effect.die('no exit state');
          const exit = ended.value.summary.state.nativeExit;
          if (exit?._tag !== 'Code' || exit.code !== 0) return yield* Effect.die(`child exit: ${JSON.stringify(exit)}`);
          yield* Fiber.interrupt(watcher);
          yield* client.closeBinding(opened.binding, principal);
        });
        return { ref, queue, input, ready, finish, began };
      });
      for (const transport of ['pty', 'pipes'] as const) {
        const name = transport === 'pty' ? 'pty-output' : 'pipe-stdout';
        if (!selected(name)) continue;
        const samples: number[] = [];
        for (let repeat = 0; repeat <= repetitions; repeat += 1) {
          const execution = yield* launch(transport, scriptCommand(transport, writeScript));
          yield* execution.ready();
          const check = createHash('sha256');
          let received = 0;
          const began = yield* now;
          yield* execution.input({ _tag: 'Write', bytes: new Uint8Array([103]) });
          let endedAt = began;
          while (received < bytes) {
            const output = yield* Queue.take(execution.queue);
            received += output.bytes.length;
            check.update(output.bytes);
            endedAt = output.at;
          }
          const elapsed = endedAt - began;
          if (received !== bytes || check.digest('hex') !== digest) return yield* Effect.die('output content differs');
          if (repeat > 0) samples.push(elapsed);
          yield* execution.finish();
        }
        metrics[name] = {
          bytes,
          samplesMs: samples,
          throughputMiBs: samples.map((ms) => bytes / 1048576 / (ms / 1000)),
          ...percentiles(samples),
        };
      }
      if (selected('pty-echo')) {
        const execution = yield* launch('pty', scriptCommand('pty', echoScript, true));
        yield* execution.ready();
        const samples: number[] = [];
        for (let repeat = 0; repeat < echoes + 10; repeat += 1) {
          const sent = new Uint8Array([97 + (repeat % 26)]);
          const began = yield* now;
          yield* execution.input({ _tag: 'Write', bytes: sent });
          const output = yield* Queue.take(execution.queue);
          const elapsed = output.at - began;
          if (output.bytes.length !== 1 || output.bytes[0] !== sent[0]) return yield* Effect.die('echo content differs');
          if (repeat >= 10) samples.push(elapsed);
        }
        yield* execution.finish();
        metrics['pty-echo'] = { bytesPerInput: 1, warmup: 10, samplesMs: samples, ...percentiles(samples) };
      }
      if (selected('pipe-stdin')) {
        const samples: number[] = [];
        const admissionMs: number[] = [];
        const afterAdmissionMs: number[] = [];
        for (let repeat = 0; repeat <= repetitions; repeat += 1) {
          const execution = yield* launch('pipes', scriptCommand('pipes', readScript));
          yield* execution.ready();
          const began = yield* now;
          for (let at = 0; at < bytes; at += chunk.length)
            yield* execution.input({ _tag: 'Write', bytes: chunk.subarray(0, Math.min(chunk.length, bytes - at)) });
          const admittedAt = yield* now;
          yield* execution.input({ _tag: 'End' });
          let receipt = '';
          let endedAt = began;
          while (!receipt.endsWith('\n')) {
            const output = yield* Queue.take(execution.queue);
            receipt += new TextDecoder().decode(output.bytes);
            endedAt = output.at;
          }
          const elapsed = endedAt - began;
          const answer = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Consumed))(receipt);
          if (answer.bytes !== bytes || answer.digest !== digest) return yield* Effect.die('stdin content differs');
          if (repeat > 0) {
            samples.push(elapsed);
            admissionMs.push(admittedAt - began);
            afterAdmissionMs.push(endedAt - admittedAt);
          }
          yield* execution.finish();
        }
        metrics['pipe-stdin'] = {
          bytes,
          writeBytes: chunk.length,
          samplesMs: samples,
          admissionMs,
          afterAdmissionMs,
          throughputMiBs: samples.map((ms) => bytes / 1048576 / (ms / 1000)),
          ...percentiles(samples),
        };
      }
      for (const transport of ['pty', 'pipes'] as const) {
        const name = transport === 'pty' ? 'pty-start' : 'pipe-start';
        if (!selected(name)) continue;
        const samples: number[] = [];
        const expected = Buffer.from(transport === 'pty' ? 'x\r\n' : 'x\n');
        for (let repeat = 0; repeat < starts + 5; repeat += 1) {
          const execution = yield* launch(transport, { program: '/bin/sh', args: ['-c', 'printf "x\\n"; read _'], environment: [] });
          const first = yield* Queue.take(execution.queue);
          const elapsed = first.at - execution.began;
          let output = Buffer.from(first.bytes);
          while (output.length < expected.length) output = Buffer.concat([output, (yield* Queue.take(execution.queue)).bytes]);
          if (!output.equals(expected)) return yield* Effect.die('start output differs');
          if (repeat >= 5) samples.push(elapsed);
          yield* execution.input({ _tag: 'Write', bytes: new Uint8Array([10]) });
          yield* execution.finish();
        }
        metrics[name] = {
          program: '/bin/sh',
          args: ['-c', 'printf "x\\n"; read _'],
          repetitions: starts,
          warmup: 5,
          samplesMs: samples,
          ...percentiles(samples),
        };
      }
      for (const transport of ['pty', 'pipes'] as const) {
        const name = transport === 'pty' ? 'pty-short' : 'pipe-short';
        if (!selected(name)) continue;
        const expected = Buffer.from(transport === 'pty' ? 'x\r\n' : 'x\n');
        const observations: ShortObservation[] = [];
        for (let repeat = 0; repeat < shorts; repeat += 1) {
          const execution = yield* launch(transport, { program: '/bin/echo', args: ['x'], environment: [] });
          const chunks: Uint8Array[] = [];
          for (;;) {
            const next = yield* Queue.take(execution.queue).pipe(Effect.catchIf(Cause.isDone, () => Effect.succeed(undefined)));
            if (next === undefined) break;
            chunks.push(next.bytes);
          }
          yield* execution.finish();
          const recorded = yield* client.read(
            { ref: execution.ref, stream: transport === 'pty' ? 'pty' : 'stdout', offset: byteOffset(0n) },
            64,
          );
          const received = Buffer.concat(chunks);
          observations.push({
            received: received.toString('hex'),
            recorded: Buffer.from(recorded.bytes).toString('hex'),
            delivered: received.equals(expected),
            retained: Buffer.from(recorded.bytes).equals(expected),
          });
        }
        metrics[name] = {
          program: '/bin/echo',
          args: ['x'],
          repetitions: shorts,
          delivered: observations.filter((sample) => sample.delivered).length,
          retained: observations.filter((sample) => sample.retained).length,
          observations,
        };
      }
      return metrics;
    }).pipe(
      Effect.scoped,
      Effect.timeout(Duration.seconds(50)),
      Effect.provide(HostRegistration.layer),
      Effect.provide(endpointConnection),
      Effect.provide(BunServices.layer),
    ),
  );
  const report = {
    sample: true,
    beganAt,
    endedAt: new Date().toISOString(),
    loadBefore,
    loadAfter: loadavg(),
    machine: { host: hostname(), os: release(), arch: arch(), cpu: cpus()[0]?.model, cpus: cpus().length, memoryBytes: totalmem() },
    build: manifest.identity,
    client: option('client') ?? '@runlith/executions/ExecutionClient',
    repetitions: metric.endsWith('-start') ? starts : metric.endsWith('-short') ? shorts : metric === 'pty-echo' ? echoes : repetitions,
    warmup: metric.endsWith('-start') ? 5 : metric.endsWith('-short') ? 0 : metric === 'pty-echo' ? 10 : 1,
    policy,
    limits,
    measured,
    boundary: metric.endsWith('-start')
      ? 'Start call through child startup and byte subscription to first ExecutionClient byte delivery; host startup excluded'
      : metric.endsWith('-short')
        ? 'immediate exit output delivered through byte subscription and retained by public Read'
        : 'input request through child consumption/output to ExecutionClient bytes; host startup and child startup excluded',
  };
  console.log(JSON.stringify(report, null, 2));
  if (option('report') !== undefined) writeFileSync(resolve(required('report')), JSON.stringify(report, null, 2));
}
