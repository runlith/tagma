import { defineInspection } from '@runlith/tagma/rules';
import type { Alias } from '../declarations/resolve';

export type VendorParams = {
  readonly source: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

export type CouplingMeasure = {
  readonly id: string;
  readonly path: string;
  readonly modules: number;
  readonly outside: number;
  readonly total: number;
};

export type CouplingParams = {
  readonly baseline: readonly CouplingMeasure[];
  readonly aliases: readonly Alias[];
};

const program = 'checks/law/programs.ts';

export const vendorIds = defineInspection<VendorParams>({ program, name: 'vendor-ids', concern: 'code' });
export const coupling = defineInspection<CouplingParams>({ program, name: 'coupling', concern: 'imports' });
