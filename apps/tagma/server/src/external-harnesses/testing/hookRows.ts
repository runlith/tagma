import type { HookRows } from '../hooks/rows.js';
import { BUILTIN_HARNESSES } from '../vendors/builtin.js';

export const builtinRows = (harness: string | null): HookRows | null => {
  if (harness === null) return { named: null, rows: BUILTIN_HARNESSES };
  const builtin = BUILTIN_HARNESSES.find((row) => row.harness === harness);
  return builtin === undefined ? null : { named: builtin, rows: [builtin] };
};
