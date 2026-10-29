import { STARTED } from './core/started.ts';
import * as runner from 'bun:test';
import { afterAll, afterEach, beforeAll, beforeEach, mock, setDefaultTimeout } from 'bun:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { carried, carry, diskContinuity, makeBed, type Bed } from './core/bed.ts';
import { HANG_MS, kindOf } from './core/files.ts';
import type { Meter } from './core/ledger.ts';
import { ORIGINAL } from './core/pristine.ts';
import { openProcesses, type Processes } from './core/processes.ts';
import { openRun, ROOT_ENV, sweepRuns } from './core/run.ts';

const meter = (): Meter => {
  const usage = process.cpuUsage();
  return { wall: Number(process.hrtime.bigint()) / 1e6, own: (usage.user + usage.system) / 1000, kids: 0 };
};

const REPO = resolve(import.meta.dir, '../../..');
const main = Bun.main;

const expose = (specifiers: readonly string[], object: Record<string, unknown>, fallback: unknown = object): void => {
  for (const specifier of specifiers) mock.module(specifier, () => ({ ...object, default: fallback }));
};

const REGISTERS = ['describe', 'test', 'it', 'beforeAll', 'beforeEach', 'afterAll', 'afterEach'] as const;

let claimed: string | undefined;

const claim = (): void => {
  if (claimed === Bun.main) return;
  claimed = Bun.main;
  setDefaultTimeout(HANG_MS);
  beforeAll(handoff, HANG_MS);
};

type Callback = (...args: unknown[]) => unknown;

const authored = (bed: Bed, file: string, fn: Callback): Callback =>
  Object.defineProperties(
    function (this: unknown, ...args: unknown[]) {
      return bed.within(file, () => Reflect.apply(fn, this, args));
    },
    { length: { value: fn.length }, name: { value: fn.name } },
  );

const registering = <F extends object>(bed: Bed | undefined, fn: F, owner?: object): F =>
  new Proxy(fn, {
    apply(target, self, args) {
      claim();
      const file = Bun.main;
      const given =
        bed === undefined ? args : args.map((arg: unknown) => (typeof arg === 'function' ? authored(bed, file, arg as Callback) : arg));
      const result: unknown = Reflect.apply(target as Callback, owner ?? self, given);
      return typeof result === 'function' ? registering(bed, result) : result;
    },
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? registering(bed, value, target) : value;
    },
  });

const coordinator = (processes: Processes): { readonly pid: number; readonly start: number } => {
  const worker = process.env['BUN_TEST_WORKER_ID'] !== undefined && / --test-worker(?: |$)/.test(processes.command(process.pid) ?? '');
  const pid = worker ? process.ppid : process.pid;
  return { pid, start: processes.facts(pid)?.start ?? 0 };
};

const engine = async (): Promise<void> => {
  const { prepareEngine, selectEngine } = await import('@runlith/sqlite-process/engine');
  await prepareEngine();
  selectEngine();
};

const confineHome = (): void => {
  const os = createRequire(import.meta.url)('node:os') as Record<string, unknown>;
  const homedir = (os['homedir'] as Record<symbol, unknown>)[ORIGINAL] ?? os['homedir'];
  os['homedir'] = Object.assign(() => process.env['HOME'] ?? (homedir as () => string)(), { [ORIGINAL]: homedir });
  expose(['node:os', 'os'], os);
};

const prepare = async (): Promise<Bed> => {
  const bed = makeBed({
    runner: 'bun',
    repo: REPO,
    file: () => Bun.main,
    refusing: process.env['RUNLITH_TEST_LAYERS'] !== 'report',
    expose,
  });
  const resource = kindOf(main) !== 'unit';
  const given = process.env[ROOT_ENV];
  const processes = resource || given === undefined || given === '' ? await openProcesses() : undefined;
  if (processes !== undefined) bed.useProcesses(processes);
  const run = openRun(processes === undefined ? undefined : coordinator(processes));
  bed.useRun(run, diskContinuity(run.root));
  if (run.fresh && processes !== undefined) sweepRuns(processes);
  if (resource) await engine();
  bed.install();
  confineHome();
  const real = { ...runner };
  const wrapped = Object.fromEntries(REGISTERS.map((name) => [name, registering(name === 'describe' ? undefined : bed, real[name])]));
  const required = createRequire(import.meta.url)('bun:test') as typeof runner;
  Object.assign(required, wrapped);
  mock.module('bun:test', () => ({ ...real, ...wrapped }));
  return carry(bed);
};

const bed = carried() ?? (await prepare());
setDefaultTimeout(HANG_MS);
bed.pend(STARTED, meter());

let engineSelected = kindOf(main) !== 'unit';

const enter = async (file: string, start?: Meter, skip?: { readonly cpu: number; readonly wall: number }): Promise<void> => {
  if (kindOf(file) !== 'unit') {
    if (bed.processes === undefined) bed.useProcesses(await openProcesses());
    if (!engineSelected) {
      await engine();
      engineSelected = true;
    }
  }
  bed.enter(file, start, skip);
};

if (bed.file === undefined) await enter(main);

const residues: string[] = [];

beforeAll(async () => {
  if (bed.file === undefined) await enter(Bun.main);
  bed.ready();
}, HANG_MS);

async function handoff(): Promise<void> {
  if (bed.file !== Bun.main) {
    const closing = bed.lastTest ?? bed.ledger.since();
    const resumed = bed.ledger.meter();
    const residue = await bed.leave(closing, resumed);
    if (residue !== undefined) residues.push(residue);
    const left = bed.ledger.meter();
    await enter(Bun.main, closing, { cpu: left.own - resumed.own + (left.kids - resumed.kids), wall: left.wall - resumed.wall });
  }
  bed.ready();
}

beforeEach(async () => {
  await handoff();
  bed.testStart();
});

afterEach(() => {
  bed.testEnd();
});

afterAll(async () => {
  const residue = await bed.leave();
  if (residue !== undefined) residues.push(residue);
  if (residues.length > 0) throw new Error(residues.splice(0).join('\n'));
}, HANG_MS);
