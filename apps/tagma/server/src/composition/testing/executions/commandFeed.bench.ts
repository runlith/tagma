import { join } from 'node:path';
import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import * as BunServices from '@effect/platform-bun/BunServices';
import { Clock, Context, Data, Effect, Exit, FiberSet, FileSystem, Layer, Metric, Scope, Stream } from 'effect';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';
import type { PlatformError } from 'effect/PlatformError';
import { PerformanceReports } from '@runlith/performance/PerformanceReports';
import { PerformanceStore } from '@runlith/performance/PerformanceStore';
import type { SlowQuery } from '@runlith/performance/protocol/queries';
import { HostRequestKey } from '@runlith/executions/protocol/execution';
import { Principal } from '@runlith/executions/protocol/custody';
import { makeRuntime } from '../../runtime.js';
import { MachineStore } from '../../../platform/contract/service/store.js';
import { MachineUnits } from '../../../platform/contract/service/units.js';
import { project as projectRow } from '../../../projects/testing/doubles.js';
import { spawnedEffect } from '../../../platform/testing/spawn.js';
import { fixtureRoot } from '../../../platform/testing/roots.js';
import { Settings } from '../../../settings/contract/service/values.js';
import { Coverage } from '../../../workspace/contract/service/roots.js';
import { performanceKeepOneTraceIn } from '../../../performance/contract/wire/settings.js';
import { TargetKey } from '../../../executions/contract/wire/targets.js';
import { principalOf } from '../../../executions/terminals/principals.js';
import { Terminals } from '../../../executions/contract/service/terminals.js';
import { targetIdentity, targetKeyOf } from '../../../executions/terminals/subjectPolicy.js';
import { TerminalScreens } from '../../../executions/contract/service/records.js';
import { HostManagement } from '../../../executions/contract/service/host.js';
import { CommandReader } from '../../../executions/contract/service/commands.js';
import { storesOver } from '../../../executions/testing/stores.js';
import { testGrantSigner } from '../../../platform/testing/grants.js';
import { endHosts, hostsUnder, noAdopters } from '../../../executions/testing/doubles.js';
import { REPO_ROOT } from '../repoRoot.js';

const [feedsArg, commandsArg, endedArg, viewedArg, churnArg, windowArg, cacheArg] = process.argv.slice(2);
const FEEDS = Number(feedsArg ?? 3);
const COMMANDS = Number(commandsArg ?? 6);
const ENDED = Number(endedArg ?? 40);
const VIEWED = Number(viewedArg ?? 0);
const CHURN_MS = Number(churnArg ?? 0);
const WINDOW_MS = Number(windowArg ?? 12_000);
const PRINTING = 'i=0; while :; do i=$((i+1)); printf "\\033[32mround %d\\033[0m\\n" $i; ls -la /usr/lib | head -120; sleep 0.4; done';
const WARM_MS = 4_000;
const KEEP_ONE_TRACE_IN = 4;
const BUILD_SCRIPT = join(REPO_ROOT, 'packages/execution-host/src/buildArtifact.ts');

type Figure = { readonly count: number; readonly sum: number };

class BenchmarkRefused extends Data.TaggedError('BenchmarkRefused')<{ readonly message: string }> {}

const histograms = Effect.fn('commandFeed.histograms')(function* () {
  const figures = new Map<string, Figure>();
  for (const snapshot of yield* Metric.snapshot) {
    if (snapshot.type !== 'Histogram' || snapshot.attributes?.measure !== 'duration') continue;
    figures.set(snapshot.id, { count: snapshot.state.count, sum: snapshot.state.sum });
  }
  return figures;
});

const main = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const owned = fixtureRoot('command-feed-bench', '');
  yield* files.makeDirectory(owned, { recursive: true });
  const home = yield* files.makeTempDirectoryScoped({ directory: owned, prefix: 'installation-' });
  yield* Effect.addFinalizer(() => endHosts(home).pipe(Effect.orDie));
  const checkout = join(home, 'checkout');
  yield* files.makeDirectory(join(checkout, 'src'), { recursive: true });
  yield* files.makeDirectory(join(home, 'db'), { recursive: true });
  yield* files.writeFileString(join(checkout, 'src/a.ts'), 'export const one = 1;\n');
  for (const args of [
    ['init', '-q', '-b', 'main', checkout],
    ['-C', checkout, 'add', '--', 'src'],
    ['-C', checkout, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'bench'],
  ]) {
    const ran = yield* spawnedEffect(['git', ...args]);
    if (!ran.success) return yield* new BenchmarkRefused({ message: ran.stderr.toString() });
  }
  const boot = Effect.fnUntraced(function* () {
    return yield* makeRuntime(
      {
        grants: testGrantSigner,
        databasePath: join(home, 'db/tagma.sqlite'),
        tokensPath: join(home, 'tokens.json'),
        attachmentsPath: join(home, 'attachments'),
        sourcePath: checkout,
        quotaProviders: [],
        spanFloorMicros: () => 0,
      },
      Layer.empty,
      new ProcessPool(undefined, 'stop', undefined, childHosting),
    );
  });
  const firstScope = yield* Scope.fork(yield* Effect.scope);
  const first = yield* Scope.provide(boot(), firstScope);
  const firstBoot = (yield* Context.get(first.executions, HostManagement).standing).boot;
  if (firstBoot._tag !== 'NoBundle') return yield* new BenchmarkRefused({ message: `a fresh installation booted ${firstBoot._tag}` });
  const bundle = firstBoot.bundle;
  const linked = Effect.fn('commandFeed.linkBundle')(function* (from: string, to: string): Effect.fn.Return<void, PlatformError> {
    const info = yield* files.stat(from);
    yield* files.makeDirectory(to, { recursive: true, mode: info.mode });
    for (const name of yield* files.readDirectory(from)) {
      const source = join(from, name);
      const target = join(to, name);
      if ((yield* files.stat(source)).type === 'Directory') yield* linked(source, target);
      else yield* files.link(source, target);
    }
  });
  if (cacheArg !== undefined && (yield* files.exists(cacheArg))) {
    yield* linked(cacheArg, bundle);
  } else {
    const built = yield* spawnedEffect([process.execPath, BUILD_SCRIPT, bundle, 'command-feed-bench']);
    if (!built.success) return yield* new BenchmarkRefused({ message: `the host bundle did not build: ${built.stderr.toString()}` });
    if (cacheArg !== undefined) yield* files.copy(bundle, cacheArg);
  }
  yield* Context.get(first.owners, Settings).write({ scope: 'user', key: performanceKeepOneTraceIn.id, value: KEEP_ONE_TRACE_IN });
  yield* Scope.close(firstScope, Exit.void);

  const served = yield* boot();
  const context = yield* served.runtime.contextEffect;
  yield* Effect.gen(function* () {
    const host = Context.get(served.executions, HostManagement);
    const terminals = Context.get(served.executions, Terminals);
    const screens = Context.get(served.executions, TerminalScreens);
    const feeds = Context.get(served.executions, CommandReader);
    const store = Context.get(served.graph, MachineStore);
    const units = Context.get(served.graph, MachineUnits);
    const coverage = Context.get(served.workspace, Coverage);
    const rows = storesOver(store.db, host.connection.installation);
    const servedBoot = (yield* host.standing).boot;
    if (servedBoot._tag !== 'Raised') return yield* new BenchmarkRefused({ message: `the bench host did not rise: ${servedBoot._tag}` });
    const projects = yield* store.db
      .insert(projectRow())
      .values({
        name: 'command-feed-bench',
        repoKey: 'command-feed-bench',
        rootPath: checkout,
        createdAt: new Date(yield* Clock.currentTimeMillis),
      })
      .returning({ id: projectRow().id });
    const projectId = projects[0]!.id;
    yield* coverage.cover(projectId);
    const holder = Principal.make('thread:command-feed-bench');
    const installation = (yield* host.connection.port.status()).installation;
    const admit = Effect.fn('commandFeed.admit')(function* (at: number, line: string) {
      const operationId = HostRequestKey.make(`op-bench-${at}`);
      const outcome = yield* host.connection.port.start(
        { installation, operation: operationId },
        {
          command: { program: '/bin/sh', args: ['-c', line], environment: [], cwd: checkout },
          transport: { _tag: 'pipes', stdin: 'ignore' },
          lifetime: 'command',
          purpose: 'command',
          admission: {
            origin: { scope: `project:${projectId}`, owner: 'thread:command-feed-bench', cohort: 'bench' },
            limits: { executionMs: 900_000, executionCeilingMs: 900_000, origin: 'rule' },
            policyIdentity: 'bench',
          },
          target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
          holder,
          origin: holder,
        },
      );
      if (outcome._tag !== 'Accepted' || outcome.execution === undefined)
        return yield* new BenchmarkRefused({ message: `command ${at} was not admitted: ${JSON.stringify(outcome)}` });
      const execution = outcome.execution;
      const key = { projectId, operationId, requester: holder, mutation: 'start' as const, targetKey: TargetKey.make(`bench-${at}`) };
      yield* units.write('commandFeed.bench.admit', (unit) =>
        Effect.gen(function* () {
          yield* rows.intents.fence(
            unit,
            { key, phase: 'reserved', holdings: {}, openedAt: yield* Clock.currentTimeMillis },
            { createdBy: holder, policyIdentity: 'bench', wait: 'background' },
          );
          yield* rows.commandRows.admitCommand(unit, key, execution);
        }),
      );
    });
    for (let at = 0; at < COMMANDS + ENDED; at += 1) yield* admit(at, at < COMMANDS ? 'sleep 600' : 'true');
    const workers = yield* FiberSet.make<void, unknown>();
    let churned = COMMANDS + ENDED;
    if (CHURN_MS > 0)
      yield* FiberSet.run(
        workers,
        Effect.forever(
          Effect.gen(function* () {
            yield* Effect.sleep(CHURN_MS);
            churned += 1;
            yield* admit(churned, 'sleep 1');
          }),
        ),
      );
    const operator = principalOf({ _tag: 'Operator' });
    const target = yield* terminals.target({ projectId, kind: 'host', cwd: checkout });
    const shell = yield* terminals.start({
      actor: { _tag: 'Operator' },
      operationId: HostRequestKey.make('op-bench-shell'),
      target,
      targetKey: targetKeyOf(targetIdentity(target, operator, operator)),
      program: '/bin/sh',
      args: ['-c', 'sleep 600'],
      transport: 'pipes',
      lifetime: 'held',
    });
    if (shell._tag !== 'Started') return yield* new BenchmarkRefused({ message: `the project's terminal did not start: ${shell._tag}` });
    let frames = 0;
    for (let at = 0; at < VIEWED; at += 1) {
      const outcome = yield* host.connection.port.start(
        { installation, operation: HostRequestKey.make(`op-bench-viewed-${at}`) },
        {
          command: { program: '/bin/sh', args: ['-c', PRINTING], environment: [], cwd: checkout },
          transport: { _tag: 'pty', geometry: { columns: 200, rows: 50 } },
          lifetime: 'held',
          purpose: 'command',
          target: { environment: 'host', namespace: 'machine', cwd: checkout, dependencies: [] },
          holder: Principal.make('operator'),
          origin: Principal.make('operator'),
        },
      );
      if (outcome._tag !== 'Started')
        return yield* new BenchmarkRefused({ message: `terminal ${at} did not start: ${JSON.stringify(outcome)}` });
      yield* FiberSet.run(
        workers,
        Stream.runForEach(screens.screens(outcome.execution), () =>
          Effect.sync(() => {
            frames += 1;
          }),
        ),
      );
    }
    let readings = 0;
    for (let at = 0; at < FEEDS; at += 1)
      yield* FiberSet.run(
        workers,
        Stream.runForEach(feeds.follow(projectId, { ended: 50 }, noAdopters), () =>
          Effect.sync(() => {
            readings += 1;
          }),
        ),
      );
    const hostCpuMs = Effect.fn('commandFeed.hostCpu')(function* () {
      let total = 0;
      for (const pid of yield* hostsUnder(home)) {
        const result = yield* spawnedEffect(['ps', '-o', 'time=', '-p', String(pid)]);
        if (!result.success) return yield* new BenchmarkRefused({ message: `host CPU could not be read: ${result.stderr.toString()}` });
        const [minutes, seconds] = result.stdout.toString().trim().split(':');
        total += (Number(minutes) * 60 + Number(seconds)) * 1000;
      }
      return total;
    });
    const measuring = Effect.gen(function* () {
      yield* Effect.sleep(WARM_MS);
      const since = yield* Clock.currentTimeMillis;
      const before = yield* histograms();
      const cpuBefore = process.cpuUsage();
      const hostBefore = yield* hostCpuMs();
      const readingsBefore = readings;
      const framesBefore = frames;
      yield* Effect.sleep(WINDOW_MS);
      const after = yield* histograms();
      const cpu = process.cpuUsage(cpuBefore);
      const hostAfter = yield* hostCpuMs();
      const readingCount = readings - readingsBefore;
      const frameCount = frames - framesBefore;
      yield* FiberSet.clear(workers);
      yield* Context.get(context, PerformanceStore).flush;
      const reports = Context.get(served.measurement, PerformanceReports);
      const bytesOf = Effect.fn('commandFeed.bytes')(function* (name: string) {
        let sampled = 0;
        let bytes = 0;
        let after: SlowQuery['after'];
        for (;;) {
          const report = yield* reports.read({ type: 'slow', name, since, limit: 50, after });
          if (report.type !== 'slow') return yield* new BenchmarkRefused({ message: `a slow query answered ${report.type}` });
          for (const span of report.spans) {
            if (span.wallTime > since + WINDOW_MS) continue;
            sampled += 1;
            const size = span.payload.attributes.bytes;
            if (typeof size === 'number') bytes += size;
          }
          if (report.next === null) return { sampled, bytes };
          after = report.next;
        }
      });
      const window = WINDOW_MS / 1000;
      const output: string[] = [];
      for (const [name, figure] of after) {
        if (!['wire.', 'CommandReader.', 'TerminalInventory.', 'Terminals.inventory'].some((prefix) => name.startsWith(prefix))) continue;
        const was = before.get(name) ?? { count: 0, sum: 0 };
        const count = figure.count - was.count;
        if (count === 0) continue;
        const sum = figure.sum - was.sum;
        const sizes = name.startsWith('wire.read.dispatch') ? yield* bytesOf(name) : undefined;
        const meanBytes = sizes === undefined || sizes.sampled === 0 ? undefined : sizes.bytes / sizes.sampled;
        output.push(
          [
            name.padEnd(44),
            `${(count / window).toFixed(2).padStart(7)}/s`,
            `${(sum / window).toFixed(1).padStart(8)} ms/s`,
            meanBytes === undefined
              ? ''
              : `${Math.round(meanBytes).toString().padStart(8)} B/frame (${sizes?.sampled} sampled) ≈ ${Math.round((meanBytes * count) / window)} B/s`,
          ].join('  '),
        );
      }
      console.log(
        `feeds ${FEEDS} · running ${COMMANDS} · exited ${ENDED} · viewed terminals ${VIEWED} · a command every ${CHURN_MS}ms · window ${window}s · readings ${readingCount} · screen updates ${frameCount}`,
      );
      console.log(
        `server cpu ${((cpu.user + cpu.system) / 1000 / window / 10).toFixed(1)}% of a core · host cpu ${((hostAfter - hostBefore) / window / 10).toFixed(1)}% of a core`,
      );
      for (const row of output.sort()) console.log(row);
    });
    yield* Effect.raceFirst(measuring, Effect.andThen(FiberSet.join(workers), Effect.never));
  }).pipe(Effect.provide(context));
});

BunRuntime.runMain(main.pipe(Effect.scoped, Effect.provide(BunServices.layer)));
