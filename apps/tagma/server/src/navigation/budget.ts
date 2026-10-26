import type { Machine } from '../platform/contract/service/capacity.js';

const GIB = 1024 ** 3;

const MACHINE_SHARE = 5 / 16;
const CLIENT = GIB;
const ENGINE_MINIMUM = 2 * GIB;
const ENGINE_FLOOR = 4 * GIB;
const ENGINE_CEILING = 6 * GIB;
const ENGINE_SHARE = 1 / 8;
const CPU_SHARE = 1 / 3;
const CPU_FLOOR = 3;
const CPU_CEILING = 4;
const CPU_TOGETHER = 2 / 3;

export type Budget = {
  readonly total: number;
  readonly engine: number;
  readonly engines: number;
  readonly cpus: number;
  readonly questions: number;
};

export const budgetOf = (machine: Machine): Budget => {
  const total = Math.max(Math.floor(machine.memoryBytes * MACHINE_SHARE), ENGINE_MINIMUM + CLIENT);
  const floor = Math.min(total - CLIENT, Math.max(ENGINE_FLOOR, Math.min(ENGINE_CEILING, Math.floor(machine.memoryBytes * ENGINE_SHARE))));
  const share = Math.max(CPU_FLOOR, Math.min(CPU_CEILING, Math.ceil(machine.parallelism * CPU_SHARE)));
  const cpus = Math.max(1, Math.min(share, Math.floor(machine.parallelism / 2)));
  const engines = Math.max(1, Math.min(Math.floor(total / (floor + CLIENT)), Math.floor((machine.parallelism * CPU_TOGETHER) / cpus)));
  return { total, engine: total - CLIENT, engines, cpus, questions: Math.max(2, cpus) };
};

export const shareOf = (budget: Budget, running: number): number => Math.floor(budget.total / Math.max(1, running));
