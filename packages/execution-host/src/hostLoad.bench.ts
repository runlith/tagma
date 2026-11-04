import { endpointConnection } from '@runlith/executions/posix/endpoint';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { holderLayer } from './composition/platform';
import { HOLDER_BINARY } from './posix/testing/holder';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duration, Effect, FileSystem, Layer, Runtime, Schema, Stream } from 'effect';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import type { Executions } from '@runlith/executions/Executions';
import { HostRegistration } from '@runlith/executions/HostRegistration';
import { Principal } from '@runlith/executions/protocol/custody';
import { PERFORMANCE_FILE } from '@runlith/executions/protocol/registration';
import { PerformanceReports, performanceReportsLayer } from '@runlith/performance/PerformanceReports';
import { PerformanceStore, performanceStoreWatchLayer } from '@runlith/performance/PerformanceStore';
import type { CpuProfileArtifact } from '@runlith/performance/CpuProfile';
import { HostBoot } from '@runlith/executions/protocol/boot';
import { serve } from './composition/host';
import { keyOf } from './hostFixture';
import { BENCH_LIMITS, benchBoot, benchClient, benchFlag } from './composition/testing/benchHost';

const SECONDS = Math.min(60, benchFlag('seconds', 30));
const TERMINALS = benchFlag('terminals', 8);
const VIEWERS = Math.min(TERMINALS, benchFlag('viewers', 4));
const BUSY_SHARE = benchFlag('busy', 0.2);

const WORKLOAD =
  'i=0; while :; do i=$((i+1)); printf "\\033[32mround %d\\033[0m\\n" $i; ls -la /usr/lib | head -120; ps -o pid=,rss= -p $$ >/dev/null; sleep 0.4; done';

const readPrincipal = Schema.decodeUnknownSync(Principal);
const readBoot = Schema.decodeUnknownEffect(Schema.fromJsonString(HostBoot));

const hosting = Effect.fnUntraced(
  function* (bootPath: string) {
    const files = yield* FileSystem.FileSystem;
    const boot = yield* readBoot(yield* files.readFileString(bootPath));
    return yield* serve(boot, { telemetry: { busy: { cpuShare: BUSY_SHARE, everyMs: 0 } } }).pipe(
      Effect.provide(holderLayer(boot.library)),
    );
  },
  Effect.scoped,
  Effect.provide(HostRegistration.layer),
  Effect.provide(endpointConnection),
  Effect.provide(BunServices.layer),
);

const cpuSeconds = (pid: number): number => {
  const text = Bun.spawnSync(['ps', '-o', 'time=', '-p', String(pid)])
    .stdout.toString()
    .trim();
  const parts = text.split(':').map(Number);
  return parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + (parts[1] ?? 0);
};

const shortUrl = (url: string): string => {
  const modules = url.lastIndexOf('/node_modules/');
  if (modules >= 0) return url.slice(modules + '/node_modules/'.length);
  const source = url.indexOf('/packages/');
  return source >= 0 ? url.slice(source + 1) : url;
};

const drive = Effect.fnUntraced(
  function* (directory: string, hostPid: number) {
    const executions = yield* benchClient(directory);
    yield* Stream.runDrain(executions.subscribe({ _tag: 'Inventory' }, BENCH_LIMITS.credits)).pipe(Effect.ignore, Effect.forkScoped);
    const started = [];
    for (let index = 0; index < TERMINALS; index += 1) {
      const launched = yield* executions.start(keyOf(`bench-${index}`), {
        command: { program: '/bin/sh', args: ['-c', WORKLOAD], environment: [] },
        transport: { _tag: 'pty', geometry: { columns: 200, rows: 50 } },
        lifetime: 'call',
        purpose: 'command',
        target: { environment: 'e', namespace: 'n', cwd: directory, dependencies: [] },
        holder: readPrincipal('bench'),
        origin: readPrincipal('bench'),
      });
      if (launched._tag !== 'Started') return yield* Effect.die(`terminal ${index} did not start: ${launched._tag}`);
      started.push(launched.execution);
    }
    for (const execution of started.slice(0, VIEWERS)) {
      yield* Stream.runDrain(executions.subscribe({ _tag: 'Screen', execution }, BENCH_LIMITS.credits)).pipe(
        Effect.ignore,
        Effect.forkScoped,
      );
    }
    const before = cpuSeconds(hostPid);
    const began = performance.now();
    yield* Effect.sleep(Duration.seconds(SECONDS));
    const cpu = cpuSeconds(hostPid) - before;
    const wall = (performance.now() - began) / 1000;
    for (const [index, execution] of started.entries()) {
      yield* executions.stop(keyOf(`bench-stop-${index}`), execution, 'explicit-stop', 'signal').pipe(Effect.ignore);
    }
    return { cpuShare: `${((100 * cpu) / wall).toFixed(0)}%`, cpuSeconds: cpu, wallSeconds: Math.round(wall) };
  },
  Effect.scoped,
  Effect.provide(HostRegistration.layer),
  Effect.provide(endpointConnection),
  Effect.provide(BunServices.layer),
);

const readBack = (directory: string) =>
  PerformanceReports.use((reports) =>
    Effect.gen(function* () {
      const vitals = yield* reports.read({ type: 'vitals', limit: 100 });
      const listed = yield* reports.read({ type: 'profiles', limit: 100 });
      if (vitals.type !== 'vitals' || listed.type !== 'profiles') return yield* Effect.die('unexpected report');
      const self = new Map<string, number>();
      const inclusive = new Map<string, number>();
      const storedBytes: Array<number> = [];
      let profiledMs = 0;
      let sampled = 0;
      for (const summary of listed.profiles) {
        const read = yield* reports.read({ type: 'profile', id: summary.id, raw: true });
        if (read.type !== 'profile' || read.profile.payload.profile === undefined) continue;
        const artifact = read.profile.payload.profile as CpuProfileArtifact;
        storedBytes.push(Buffer.byteLength(JSON.stringify(read.profile.payload)));
        profiledMs += summary.requestedDurationMs;
        const nodes = new Map(artifact.nodes.map((node) => [node.id, node]));
        const parent = new Map<number, number>();
        for (const node of artifact.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
        const label = (id: number) => {
          const frame = nodes.get(id)?.callFrame;
          return frame === undefined ? '?' : `${frame.functionName || '(anonymous)'} ${shortUrl(frame.url)}:${frame.lineNumber + 1}`;
        };
        for (const id of artifact.samples) {
          const leaf = label(id);
          if (leaf.startsWith('(idle)') || leaf.startsWith('(root)') || leaf.startsWith('(program)')) continue;
          sampled += 1;
          self.set(leaf, (self.get(leaf) ?? 0) + 1);
          const seen = new Set<string>();
          for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
            const name = label(at);
            if (seen.has(name)) continue;
            seen.add(name);
            inclusive.set(name, (inclusive.get(name) ?? 0) + 1);
          }
        }
      }
      const ranked = (counts: Map<string, number>, count: number) =>
        [...counts]
          .sort((left, right) => right[1] - left[1])
          .slice(0, count)
          .map(
            ([name, samples]) =>
              `${samples.toString().padStart(6)} (${((100 * samples) / Math.max(1, sampled)).toFixed(1).padStart(5)}%)  ${name}`,
          );
      return {
        vitals: vitals.vitals.map((vital) => ({
          cpuMs: Math.round((vital.payload.cpu.userMicros + vital.payload.cpu.systemMicros) / 1000),
          windowMs: Math.round(vital.monotonicEnd - vital.monotonicStart),
        })),
        profiles: listed.profiles.map((summary) => `${summary.requestedBy} ${Math.round(summary.requestedDurationMs)} ms`),
        profiledMs: Math.round(profiledMs),
        storedProfileBytes: storedBytes,
        busySamples: sampled,
        self: ranked(self, 30),
        inclusive: ranked(inclusive, 40),
      };
    }),
  ).pipe(
    Effect.provide(performanceReportsLayer.pipe(Layer.provide(performanceStoreWatchLayer({ path: join(directory, PERFORMANCE_FILE) })))),
  );

if (process.argv.includes('--serve')) {
  BunRuntime.runMain(hosting(process.argv[process.argv.indexOf('--serve') + 1]!), {
    teardown: (exit) => Runtime.defaultTeardown(exit, (code) => process.exit(code)),
  });
} else {
  const directory = mkdtempSync(join(tmpdir(), 'host-load-'));
  const boot = benchBoot(directory);
  const host = Bun.spawn([HOLDER_BINARY, directory, process.execPath, import.meta.path, `--busy=${BUSY_SHARE}`, '--serve', boot], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  try {
    const measured = await Effect.runPromise(drive(directory, host.pid));
    const retained = await Effect.runPromise(readBack(directory));
    const report = { terminals: TERMINALS, viewers: VIEWERS, busyShare: BUSY_SHARE, ...measured, ...retained };
    const out = join(tmpdir(), 'host-load-report.json');
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(readFileSync(out, 'utf8'));
  } finally {
    host.kill('SIGKILL');
    await host.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}
