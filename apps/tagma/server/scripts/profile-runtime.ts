import { spawnSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProcessPool } from '@runlith/sqlite-process/ProcessPool';
import { childHosting } from '@runlith/sqlite-process/children';

const cpu = (): number => {
  const used = process.cpuUsage();
  return (used.user + used.system) / 1000;
};
const wall = (): number => performance.now();

const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) ?? null;
const idleMs = Number(process.argv.find((arg) => arg.startsWith('--idle='))?.slice(7) ?? 3000);
const drivers = process.argv.find((arg) => arg.startsWith('--drivers='))?.slice(10);

type Spawned = { readonly at: number; readonly argv: string; readonly via: string; readonly span: string; readonly frames: string };
const spawned: Spawned[] = [];
const t0 = wall();
let fiberOf: () => { span: string; frames: string } = () => ({ span: '', frames: '' });
const record = (via: string, argv: readonly unknown[]) =>
  spawned.push({ at: Math.round(wall() - t0), argv: argv.map(String).join(' ').slice(0, 120), via, ...fiberOf() });

const bunSpawn = Bun.spawn;
const bunSpawnSync = Bun.spawnSync;
(Bun as { spawn: unknown }).spawn = (first: unknown, ...rest: unknown[]) => {
  const argv = Array.isArray(first) ? first : ((first as { cmd?: unknown[] }).cmd ?? [String(first)]);
  record('Bun.spawn', argv);
  return (bunSpawn as (...args: unknown[]) => unknown)(first, ...rest);
};
(Bun as { spawnSync: unknown }).spawnSync = (first: unknown, ...rest: unknown[]) => {
  const argv = Array.isArray(first) ? first : ((first as { cmd?: unknown[] }).cmd ?? [String(first)]);
  record('Bun.spawnSync', argv);
  return (bunSpawnSync as (...args: unknown[]) => unknown)(first, ...rest);
};
for (const name of ['spawn', 'execFile', 'exec', 'fork', 'spawnSync', 'execFileSync', 'execSync'] as const) {
  const original = childProcess[name] as (...args: unknown[]) => unknown;
  (childProcess as Record<string, unknown>)[name] = (command: unknown, args?: unknown, ...rest: unknown[]) => {
    record(`child_process.${name}`, [command, ...(Array.isArray(args) ? args : [])]);
    return original(command, args, ...rest);
  };
}

const resolved: { readonly at: number; readonly path: string }[] = [];
if (process.argv.includes('--modules'))
  Bun.plugin({
    name: 'resolutions',
    setup: (build) => {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.importer !== '') resolved.push({ at: Math.round(wall() - t0), path: `${args.importer} -> ${args.path}` });
        return undefined;
      });
    },
  });
const profiling = process.argv.find((arg) => arg.startsWith('--profile='))?.slice(10) ?? null;
const inspector = profiling === null ? null : new (await import('node:inspector/promises')).Session();
if (inspector !== null) {
  inspector.connect();
  await inspector.post('Profiler.enable');
  await inspector.post('Profiler.setSamplingInterval', { interval: 500 });
  await inspector.post('Profiler.start');
}
const marks: Record<string, number> = { profiled: wall() - t0 };
const startCpu = cpu();
const { Context, Effect, Exit, Layer, Scope, Tracer } = await import('effect');
const { FiberRuntimeMetrics } = await import('effect/Metric');
const { CurrentStackFrame } = await import('effect/References');
const { makeRuntime } = await import('../src/composition/runtime.js');
const { TESTING_ADAPTERS } = await import('../src/composition/testing/adapters.js');
const { testGrantSigner } = await import('../src/platform/testing/grants.js');
const { COMPOSED, DRIVERS } = await import('../src/composition/testing/composed.js');
type DriverId = import('../src/composition/manifest.js').DriverId;
const importCpu = cpu();
const importWall = wall();

type FiberContext = import('effect').Context.Context<never>;
type Fiber = { readonly id: number; readonly at: number; readonly span: string; readonly frames: string; ended: boolean };
const fibers = new Map<FiberContext, Fiber>();
let fiberCount = 0;
const named = (context: FiberContext): { span: string; frames: string } => {
  const parent = Context.getOption(context, Tracer.ParentSpan);
  const spans: string[] = [];
  let span = parent._tag === 'Some' ? parent.value : undefined;
  while (span !== undefined && spans.length < 4) {
    spans.push(span._tag === 'Span' ? span.name : 'external');
    span = span._tag === 'Span' && span.parent._tag === 'Some' ? span.parent.value : undefined;
  }
  const frames: string[] = [];
  let frame = Context.get(context, CurrentStackFrame);
  while (frame !== undefined && frames.length < 4) {
    frames.push(`${frame.name}${(frame.stack() ?? '').replace(/.*\/runlith\//, ' @').replace(/\)$/, '')}`);
    frame = frame.parent;
  }
  return { span: spans.join(' < '), frames: frames.join(' < ') };
};
const { getCurrent } = await import('effect/Fiber');
fiberOf = () => {
  const current = getCurrent();
  return current === undefined ? { span: 'outside a fiber', frames: '' } : named(current.context);
};
const recorder = {
  recordFiberStart: (context: FiberContext) => {
    fiberCount += 1;
    fibers.set(context, { id: fiberCount, at: Math.round(wall() - t0), ...named(context), ended: false });
  },
  recordFiberEnd: (context: FiberContext) => {
    const fiber = fibers.get(context);
    if (fiber !== undefined) fiber.ended = true;
  },
};

const home = mkdtempSync(join(tmpdir(), 'tagma-runtime-profile-'));
const data = join(home, 'home');
const serverPath = join(home, 'source', 'server');
mkdirSync(data, { recursive: true });
mkdirSync(serverPath, { recursive: true });

const descendants = (): string[] => {
  const table = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout.split('\n');
  const rows = table.flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }];
  });
  const mine = new Set([process.pid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows)
      if (!mine.has(row.pid) && mine.has(row.ppid)) {
        mine.add(row.pid);
        grew = true;
      }
  }
  return rows.filter((row) => row.pid !== process.pid && mine.has(row.pid)).map((row) => row.command.slice(0, 160));
};

const world = process.argv.includes('--world');
const { makeDoorWorld } = world ? await import('../src/composition/testing/doorFixture.js') : { makeDoorWorld: null };
const worldImportCpu = cpu();
const scope = Effect.runSync(Scope.make());
const buildCpu = cpu();
const buildWall = wall();
const isDriver = (id: string): id is DriverId => DRIVERS.has(id);
const chosen = drivers === undefined ? {} : { drivers: drivers === 'none' ? [] : drivers.split(',').filter(isDriver) };
const runtime =
  makeDoorWorld === null
    ? await Effect.runPromise(
        Scope.provide(
          makeRuntime(
            {
              ...COMPOSED,
              adapters: TESTING_ADAPTERS,
              grants: testGrantSigner,
              profileWindowMs: () => 0,
              quotaProviders: [],
              databasePath: join(data, 'tagma.sqlite'),
              tokensPath: join(data, 'tokens.json'),
              attachmentsPath: join(data, 'attachments'),
              sourcePath: serverPath,
              source: { startedAt: '2026-01-01T00:00:00.000Z', revision: { head: 'wor1dcut', dirty: false } },
              ...chosen,
            },
            Layer.succeed(FiberRuntimeMetrics, recorder),
            new ProcessPool(undefined, 'stop', undefined, childHosting),
          ),
          scope,
        ).pipe(Effect.provideService(FiberRuntimeMetrics, recorder)),
      )
    : null;
const door =
  makeDoorWorld === null
    ? null
    : await Effect.runPromise(Scope.provide(makeDoorWorld(), scope).pipe(Effect.provideService(FiberRuntimeMetrics, recorder)));
const builtCpu = cpu();
const builtWall = wall();
const atBuild = descendants();
const opCpu = cpu();
if (door !== null) {
  await Effect.runPromise(door.stealthProject().pipe(Effect.provideService(FiberRuntimeMetrics, recorder)));
  marks.project = wall() - t0;
  await Effect.runPromise(door.op('list_projects', {}));
} else await runtime!.runtime.runPromise(Effect.void);
const projectCpu = cpu();
await new Promise((resolve) => setTimeout(resolve, idleMs));
const idleCpu = cpu();
const atIdle = descendants();
const standing = [...fibers.values()].filter((fiber) => !fiber.ended);
marks.import = importWall - t0;
marks.built = builtWall - t0;
marks.idle = wall() - t0;
if (inspector !== null && profiling !== null) {
  const { profile } = await inspector.post('Profiler.stop');
  writeFileSync(profiling, JSON.stringify({ ...profile, marks }));
}
await Effect.runPromise(
  runtime === null ? Scope.close(scope, Exit.void) : Effect.andThen(runtime.closeStack, Scope.close(scope, Exit.void)),
);
const closedCpu = cpu();
rmSync(home, { recursive: true, force: true });

const report = {
  cpuMs: {
    import: Math.round(importCpu - startCpu),
    worldImport: Math.round(worldImportCpu - importCpu),
    makeRuntime: Math.round(builtCpu - buildCpu),
    project: Math.round(projectCpu - opCpu),
    idle: Math.round(idleCpu - projectCpu),
    close: Math.round(closedCpu - idleCpu),
  },
  wallMs: { import: Math.round(importWall - t0), makeRuntime: Math.round(builtWall - buildWall) },
  fibers: {
    started: fiberCount,
    standingAfterIdle: standing,
    startedAfterBuild: [...fibers.values()].filter((fiber) => fiber.at > builtWall - t0),
  },
  processes: { spawned, atBuild, atIdle },
  modules: resolved,
};
const text = JSON.stringify(report, null, 1);
if (out === null) console.log(text);
else writeFileSync(out, text);
console.log(JSON.stringify({ cpuMs: report.cpuMs, wallMs: report.wallMs, fibers: fiberCount, spawned: spawned.length }));
if (process.argv.includes('--exit')) process.exit(0);
