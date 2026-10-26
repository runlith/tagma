import { Clock, Effect, Layer } from 'effect';
import { Git } from '@runlith/git/Git';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import type { PreservationCommit } from '../worktrees/contract/service/preservation.js';
import { commitLandingsLayer } from './commitLandings.js';
import { recoverLandings } from './land/intents.js';
import { checkoutLanes, LandingLanes } from './land/lanes.js';
import { preservationCommitLayer } from './preservation/commit.js';
import { pendingBoardLayer } from './queue/board.js';
import { intentLifecycle } from './store/intentLifecycle.js';

const landingRecovery = (after: Effect.Effect<void>): Layer.Layer<never, never, MachineStore | MachineUnits | Git> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const lifecycle = intentLifecycle((yield* MachineStore).db, yield* MachineUnits);
      const git = yield* Git;
      const commits = (yield* LandingLanes).commits;
      const startedAt = new Date(yield* Clock.currentTimeMillis);
      yield* Effect.forkScoped(
        after.pipe(
          Effect.andThen(recoverLandings(lifecycle, git, startedAt, commits)),
          Effect.tap((report) =>
            report.landed.length === 0 && report.forgotten.length === 0 && report.lost.length === 0 && report.unread.length === 0
              ? Effect.void
              : Effect.logWarning('landings left open by an earlier process', report),
          ),
          Effect.tapError((failure) => Effect.logWarning('open landings could not be read', { failure: failure.message })),
        ),
      );
    }),
  );

const landingLanes = Layer.effect(LandingLanes, checkoutLanes);

export const landingLayer = Layer.unwrap(
  Effect.map(Maintenance, ({ opened }) =>
    Layer.mergeAll(preservationCommitLayer(opened), landingRecovery(opened), pendingBoardLayer, commitLandingsLayer).pipe(
      Layer.provideMerge(landingLanes),
    ),
  ),
);
