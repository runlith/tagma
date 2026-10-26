import type { HarnessAskedModel } from '../../threads/contract/wire/harness/askedModel.js';
import type { HarnessName } from '../../threads/contract/wire/harness/names.js';
import type { KernelSeat, SeatedHarness } from '../../threads/contract/wire/harness/seat.js';
import { harnessFacet } from '../../threads/contract/wire/harness/types.js';
import { acpKernel } from '../birth/seat.js';

export const acpTestKernel = (name: HarnessName, agent: string | null, asked: HarnessAskedModel | undefined): KernelSeat =>
  acpKernel(name, agent, asked, {});

export const acpTestSeat = (name: HarnessName, agent: string | null, asked: HarnessAskedModel | undefined): SeatedHarness => ({
  facet: harnessFacet(name),
  kernel: acpKernel(name, agent, asked, {}),
});
