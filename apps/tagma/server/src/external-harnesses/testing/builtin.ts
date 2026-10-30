import type { HarnessAdapter } from '../contract/service/adapter.js';
import { BUILTIN_HARNESSES } from '../vendors/builtin.js';

export const builtinHarness = (id: string): HarnessAdapter => {
  const row = BUILTIN_HARNESSES.find((one) => one.harness === id);
  if (row === undefined) throw new Error(`no builtin harness ${id}`);
  return row;
};
