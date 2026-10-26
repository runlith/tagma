import { LONGEST_ACT_MS } from '@runlith/agent/callProgress';
import { unruledTimes } from '../CommandWork';
import type { ToolFactoryOptions } from '../workspace';
import { machineWorld } from '../world/machine';

export const toolOptions = (options: Partial<ToolFactoryOptions> & Pick<ToolFactoryOptions, 'cwd'>): ToolFactoryOptions => ({
  world: machineWorld,
  commandTimes: unruledTimes,
  searchMs: LONGEST_ACT_MS,
  ...options,
});
