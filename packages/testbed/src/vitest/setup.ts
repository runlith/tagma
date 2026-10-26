import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { carried, carry, makeBed, type Bed } from '../core/bed.ts';
import type { Meter } from '../core/ledger.ts';
import { openProcesses } from '../core/processes.ts';
import { openRun } from '../core/run.ts';

type Module = Record<string, unknown>;
type Task = { readonly name: string; readonly suite?: Task; readonly result?: { readonly state?: string } };

const EXPOSED = Symbol.for('runlith.testbed.exposed');
const RUNNER = /\/node_modules\/(?:vitest|@vitest\/[^/]+|vite)\//;
const OURS = '/packages/testbed/src/';

const exposures = ((globalThis as unknown as Record<symbol, Map<string, Module>>)[EXPOSED] ??= new Map());

const meter = (): Meter => {
  const usage = process.cpuUsage();
  return { wall: Number(process.hrtime.bigint()) / 1e6, own: (usage.user + usage.system) / 1000, kids: 0 };
};

const started = meter();

const worker = (): { filepath?: string } | undefined =>
  (globalThis as unknown as { __vitest_worker__?: { filepath?: string } }).__vitest_worker__;

const fileOf = (): string => worker()?.filepath ?? '';

const exempt = (stack: string | undefined): boolean => {
  const frame = (stack ?? '')
    .split('\n')
    .slice(1)
    .find((line) => line.includes('/') && !line.includes(OURS) && !line.includes('node:'));
  return frame !== undefined && RUNNER.test(frame);
};

const expose = (specifiers: readonly string[], object: Module, fallback: unknown = object): void => {
  for (const specifier of specifiers) exposures.set(specifier, { ...object, default: fallback });
};

const prepare = async (): Promise<Bed> => {
  const bed = makeBed({
    runner: 'vitest',
    repo: resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
    file: fileOf,
    refusing: process.env['RUNLITH_TEST_LAYERS'] !== 'report',
    expose,
    exempt,
  });
  bed.useProcesses(await openProcesses());
  bed.useRun(openRun(undefined));
  return carry(bed);
};

const bed = carried() ?? (await prepare());
bed.install();
if (typeof Bun === 'undefined')
  (createRequire(import.meta.url)('node:module') as { syncBuiltinESMExports: () => void }).syncBuiltinESMExports();
for (const [specifier, module] of exposures) vi.doMock(specifier, () => module);
bed.pend(started, meter());

const named = (task: Task): string => {
  const names = [task.name];
  for (let at = task.suite; at?.suite !== undefined; at = at.suite) names.unshift(at.name);
  return names.join(' > ');
};

if (bed.file === undefined) bed.enter(fileOf());

beforeAll(() => {
  if (bed.file === undefined) bed.enter(fileOf());
  bed.ready();
});

beforeEach(() => {
  bed.testStart();
});

afterEach(({ task }) => {
  bed.testEnd(named(task as Task), () => (task as Task).result?.state);
});

afterAll(async () => {
  const residue = await bed.leave();
  if (residue !== undefined) throw new Error(residue);
});
