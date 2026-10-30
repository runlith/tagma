import type { HookRows } from '../hooks/rows.js';
import type { HarnessAdapters } from '../contract/service/adapters.js';
import { SESSION_SIGNERS } from '../contract/wire/sessionVariables.js';
import { BUILTIN_HARNESSES } from '../vendors/builtin.js';

export const builtinRows = (harness: string | null): HookRows | null => {
  if (harness === null) return { named: null, rows: BUILTIN_HARNESSES, signers: SESSION_SIGNERS };
  const builtin = BUILTIN_HARNESSES.find((row) => row.harness === harness);
  return builtin === undefined ? null : { named: builtin, rows: [builtin], signers: SESSION_SIGNERS };
};

export const hookRowsOf = (adapters: HarnessAdapters['Service'], harness: string | null): HookRows | null => {
  const signers = adapters.all().map(({ harness: name, variable }) => ({ harness: name, variable }));
  if (harness === null) return { named: null, rows: adapters.all(), signers };
  const row = adapters.find(harness);
  return row === null ? null : { named: row, rows: [row], signers };
};
