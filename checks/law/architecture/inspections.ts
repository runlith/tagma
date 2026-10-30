import { defineInspection } from '@runlith/tagma/rules';

export type VendorParams = {
  readonly source: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

const program = 'checks/law/programs.ts';

export const vendorIds = defineInspection<VendorParams>({ program, name: 'vendor-ids', concern: 'code' });
