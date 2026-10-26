import { Context, Effect, Layer } from 'effect';
import type { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { RootReservations } from '../workspace/contract/service/roots.js';
import { projectRootMembershipLayer } from '../workspace/layer.js';
import { TreeSetupState } from '../commit-steps/contract/service/setup.js';
import { WorktreeRecords } from './contract/service/worktrees.js';
import { WorktreeIntents } from './contract/service/intents.js';
import { Worktrees, type WorktreeFolder } from './contract/service/creation.js';
import { makeWorktreeStore } from './store/registry.js';
import { makeWorktreeCreator } from './creation/execute.js';
import { makeCreationDriver } from './creation/acts.js';

export const worktreeRecordsLayer: Layer.Layer<WorktreeRecords | WorktreeIntents | RootReservations, never, MachineStore> =
  Layer.effectContext(
    Effect.map(makeWorktreeStore, (records) =>
      Context.make(WorktreeRecords, records).pipe(Context.add(WorktreeIntents, records), Context.add(RootReservations, records)),
    ),
  ).pipe(Layer.provide(projectRootMembershipLayer));

export const worktreesLayer = (folder: WorktreeFolder) =>
  Layer.effect(
    Worktrees,
    Effect.flatMap(makeWorktreeCreator, (worktrees) => makeCreationDriver({ worktrees, folder })),
  );

export const setupStateLayer = Layer.effect(
  TreeSetupState,
  Effect.gen(function* () {
    const records = yield* WorktreeRecords;
    const units = yield* MachineUnits;
    return {
      of: Effect.fn('TreeSetupState.of')(function* (projectId: number, root: string) {
        const read = yield* Effect.result(units.read((unit) => records.records(projectId, unit)));
        if (read._tag === 'Failure') {
          yield* Effect.logWarning('the worktree setup state could not be read for a missing commit step tool', {
            root,
            reason: String(read.failure),
          });
          return null;
        }
        const setup = read.success.find((one) => one.path === root)?.setup;
        return setup === 'pending' || setup === 'running' || setup === 'failed' ? setup : null;
      }),
    };
  }),
);
