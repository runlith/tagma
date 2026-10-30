import type { HookRows } from '../hooks/rows.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import { SHIPPED_HARNESSES } from './builtin.js';

const SIGNERS = SHIPPED_HARNESSES.map(({ harness, variable }) => ({ harness, variable }));

export const builtinRows = (harness: string | null): HookRows | null => {
  if (harness === null) return { named: null, rows: SHIPPED_HARNESSES, signers: SIGNERS };
  const builtin = SHIPPED_HARNESSES.find((row) => row.harness === harness);
  return builtin === undefined ? null : { named: builtin, rows: [builtin], signers: SIGNERS };
};

export const hookRowsOf = (adapters: HarnessAdapters['Service'], harness: string | null): HookRows | null => {
  const signers = adapters.all().map(({ harness: name, variable }) => ({ harness: name, variable }));
  if (harness === null) return { named: null, rows: adapters.all(), signers };
  const row = adapters.find(harness);
  return row === null ? null : { named: row, rows: [row], signers };
};
