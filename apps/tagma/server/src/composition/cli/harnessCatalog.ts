import type { HarnessCatalog } from '../../external-harnesses/hooks/rows.js';
import { SIGNERS } from './signers.js';

export const HARNESS_CATALOG: HarnessCatalog = {
  declarations: async (machine, harness) => (await import('./installedHarness.js')).harnessDeclarations(machine, harness),
  signers: SIGNERS,
};
