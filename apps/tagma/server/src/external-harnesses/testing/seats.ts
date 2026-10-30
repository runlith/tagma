import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { KernelSeat, SeatedHarness } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { acpKernel, terminalKernel } from '../birth/seat.js';
import type { HarnessAdapter } from '../contract/service/adapter.js';
import { harnessPresentation } from '../contract/service/table.js';
import { builtinHarness } from './builtin.js';

export const terminalTestKernel = (row: HarnessAdapter): KernelSeat => terminalKernel(row, undefined, false, {});

export const acpTestKernel = (name: HarnessName, agent: string | null, asked: HarnessAskedModel | undefined): KernelSeat =>
  acpKernel(builtinHarness(name), agent, asked, {});

export const acpTestSeat = (name: HarnessName, agent: string | null, asked: HarnessAskedModel | undefined): SeatedHarness => ({
  facet: harnessFacet(name, harnessPresentation(builtinHarness(name))),
  kernel: acpKernel(builtinHarness(name), agent, asked, {}),
});
