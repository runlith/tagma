import { closeSync, mkdirSync, openSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { closeOnExec, lockExclusive, unlock } from '@runlith/file-lock/flock';
import { BASE } from './core/run.ts';

export const SLOT_ENV = 'RUNLITH_TEST_SLOT';
export const ADMITTED_ENV = 'TESTBED_ADMITTED';
export type Units = {
  readonly held: number;
  readonly queued: number;
  readonly entry: number;
  readonly keep: (count: number) => number;
  readonly release: () => void;
};

export const NICE = 10;

const WAIT_MS = 50;

const WORKER_MEMORY = 2 * 1024 ** 3;

const countOf = (name: string, value: string): number => {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error(`${name} must be a positive integer`);
  return count;
};

export const machineBudget = (
  env: Record<string, string | undefined>,
  memory = Math.min(totalmem(), process.constrainedMemory() || Infinity),
): number => {
  const fixed = env['TESTBED_BUDGET'];
  if (fixed !== undefined) return countOf('TESTBED_BUDGET', fixed);
  const override = env['TESTBED_CORES'];
  const cores = override === undefined ? availableParallelism() : countOf('TESTBED_CORES', override);
  return Math.max(
    1,
    Math.min(cores - Math.max(2, Math.floor(cores / 8)), Math.floor((cores * 2) / 3), Math.floor(memory / 2 / WORKER_MEMORY)),
  );
};

export const budgetRoot = (): string => process.env['TESTBED_BUDGET_ROOT'] ?? join(BASE, 'budget');

export const freeUnits = (root: string, budget: number): number => {
  const units = join(root, 'units');
  mkdirSync(units, { recursive: true });
  let free = 0;
  for (let index = 0; index < budget; index++) {
    const handle = openSync(join(units, `${index}.lock`), 'a', 0o600);
    try {
      if (lockExclusive(handle) === 'locked') free++;
    } finally {
      closeSync(handle);
    }
  }
  return free;
};

const enter = (commands: string): { readonly handle: number; readonly name: string } => {
  const name = `${process.pid}-${crypto.randomUUID()}.lock`;
  const staged = join(commands, `${name}.staged`);
  const handle = openSync(staged, 'w', 0o600);
  closeOnExec(handle);
  lockExclusive(handle);
  renameSync(staged, join(commands, name));
  return { handle, name };
};

const others = (commands: string, self: string): number => {
  let alive = 0;
  for (const name of readdirSync(commands)) {
    if (name === self || !name.endsWith('.lock')) continue;
    const path = join(commands, name);
    let probe: number;
    try {
      probe = openSync(path, 'r');
    } catch {
      continue;
    }
    try {
      if (lockExclusive(probe) === 'held') alive++;
      else unlinkSync(path);
    } catch {
      continue;
    } finally {
      closeSync(probe);
    }
  }
  return alive;
};

export const acquireUnits = async (
  root: string,
  budget: number,
  wanted: number,
  admitted: boolean,
  waiting: (commands: number) => void = () => undefined,
  quantum = 1,
): Promise<Units> => {
  const started = performance.now();
  const units = join(root, 'units');
  const commands = join(root, 'commands');
  mkdirSync(units, { recursive: true });
  mkdirSync(commands, { recursive: true });
  const entry = enter(commands);
  const handles: number[] = [];
  const held: number[] = [];
  let told = false;
  try {
    for (let index = 0; index < budget; index++) {
      const handle = openSync(join(units, `${index}.lock`), 'a', 0o600);
      handles.push(handle);
      closeOnExec(handle);
    }
    for (;;) {
      const peers = others(commands, entry.name);
      const share = Math.min(wanted, budget, admitted ? budget : Math.ceil(budget / (peers + 1)));
      const asked = Math.max(quantum, Math.floor(share / quantum) * quantum);
      for (const handle of handles) {
        if (held.length === asked) break;
        if (lockExclusive(handle) === 'locked') held.push(handle);
      }
      const complete = Math.floor(held.length / quantum) * quantum;
      while (held.length > complete) unlock(held.pop()!);
      if (held.length > 0) {
        let released = false;
        const kept = [...held];
        return {
          held: held.length,
          queued: performance.now() - started,
          entry: entry.handle,
          keep: (count) => {
            while (!released && kept.length > Math.max(1, count)) closeSync(kept.pop()!);
            return kept.length;
          },
          release: () => {
            if (released) return;
            released = true;
            for (const handle of kept) closeSync(handle);
            unlinkSync(join(commands, entry.name));
            closeSync(entry.handle);
          },
        };
      }
      if (!told) {
        told = true;
        waiting(peers);
      }
      await Bun.sleep(WAIT_MS);
    }
  } catch (cause) {
    unlinkSync(join(commands, entry.name));
    closeSync(entry.handle);
    throw cause;
  } finally {
    for (const handle of handles) if (!held.includes(handle)) closeSync(handle);
  }
};
