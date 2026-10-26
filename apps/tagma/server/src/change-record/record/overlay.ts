import type { Context } from 'effect';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { CommitOverlay } from '../../workspace/contract/service/checkouts.js';
import { pathsOfCommit } from './reads.js';

export const commitOverlay = (
  store: Context.Service.Shape<typeof MachineStore>,
  units: MachineUnits['Service'],
): CommitOverlay['Service'] => ({
  pathsOf: (rootId, projectId, threadId, commit) => pathsOfCommit(units, store, projectId, threadId, commit, rootId),
});
