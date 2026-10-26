import { availableParallelism, totalmem } from 'node:os';
import { Context } from 'effect';
import { type Capacity as Slots, capacity, type PoolDeclaration } from '@runlith/held/Capacity';

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

export type Machine = { readonly parallelism: number; readonly memoryBytes: number };

export type Figures = {
  readonly serverMemory: number;
  readonly serverReservations: number;
  readonly childEnvelopes: number;
  readonly recoveryShare: number;
  readonly heavySlots: number;
  readonly readersPerStore: number;
  readonly computeToolsPerStep: number;
  readonly batchBytes: number;
};

export const figures = (machine: Machine): Figures => {
  const serverMemory = Math.min(0.5 * machine.memoryBytes, machine.memoryBytes - Math.max(4 * GIB, 0.25 * machine.memoryBytes));
  const heavySlots = Math.max(1, machine.parallelism - 1);
  return {
    serverMemory,
    serverReservations: 0.6 * serverMemory,
    childEnvelopes: 0.3 * serverMemory,
    recoveryShare: 0.1 * serverMemory,
    heavySlots,
    readersPerStore: Math.min(4, heavySlots + 1),
    computeToolsPerStep: Math.max(2, machine.parallelism),
    batchBytes: Math.min(64 * MIB, serverMemory / 64),
  };
};

export const HEAVY = 'heavy';

export const heavyPool = (machine: Machine): PoolDeclaration => {
  const units = figures(machine).heavySlots;
  return { name: HEAVY, units, limits: { call: Math.max(1, units - 1), background: Math.max(1, units - 2) } };
};

export const thisMachine = (): Machine => ({ parallelism: availableParallelism(), memoryBytes: totalmem() });

export class Capacity extends Context.Service<Capacity, Slots>()('tagma/platform/Capacity') {}

export const serverCapacity = (pools: readonly PoolDeclaration[]): Slots => capacity(pools, { admission: Infinity, queued: Infinity });
