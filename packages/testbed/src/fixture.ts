import { createRequire } from 'node:module';
import type { Bed } from './core/bed.ts';
import type { Item, Meter, WorldTaken } from './core/ledger.ts';
import type { Hold } from './core/watch.ts';
import { pristine } from './core/pristine.ts';
import { locate as locationOf, type PathLocation, REPORT_ENV, ROOT_ENV } from './core/run.ts';

const files = createRequire(import.meta.url)('node:fs') as typeof import('node:fs');

const bed = (): Bed | undefined => (globalThis as unknown as Record<symbol, Bed | undefined>)[Symbol.for('runlith.testbed')];

const nothing = (): void => {};

export const span = (item: Item): (() => void) => bed()?.span(item) ?? nothing;

export const measure = async <A>(item: Item, work: () => A | Promise<A>): Promise<A> => {
  const stop = span(item);
  try {
    return await work();
  } finally {
    stop();
  }
};

export const hold = (child: Parameters<Bed['hold']>[0], options?: Hold): void => bed()?.hold(child, options);

export const holding = (): (() => void) => bed()?.holding() ?? nothing;

export const claim = (home: string): (() => void) => bed()?.claim(home) ?? nothing;

export const release = (pid: number): void => bed()?.release(pid);

export const meter = (): Meter | undefined => bed()?.ledger.meter();

export const worldTaken = (taken: WorldTaken): void => bed()?.world(taken);

export const runRoot = (): string | undefined => bed()?.run?.root || process.env[ROOT_ENV] || undefined;

export const reportPath = (): string | undefined => bed()?.run?.report || process.env[REPORT_ENV] || undefined;

export const locate = (path: string): PathLocation => locationOf(path);

export const writeDiagnostic = (path: string, data: string): void => pristine(files.writeFileSync)(path, data);
