import { Context, Effect, FileSystem } from 'effect';
import { Git } from '@runlith/git/Git';
import { ChangeRecord } from '../../change-record/contract/service/record.js';
import { LineWrites } from '../../change-record/contract/service/lineWrites.js';
import { changeRecordOf, intakeOf } from '../../change-record/testing/doubles.js';
import { gitCheckoutPaths, TEST_CHECKOUT } from '../../workspace/testing/doubles.js';
import { MachineStore } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CommitLandings } from '../../landing/contract/service/commitLandings.js';
import { commitLandingsOver } from '../../landing/testing/doubles.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { makeGitCommitTrees } from '../../workspace/checkouts/commitTrees.js';
import { lineWrites } from '../lineWrites.js';
import type { WorkingOrigins } from '../../workspace/contract/service/places.js';
import type { WorkingRoot } from '../../workspace/contract/wire/place.js';
import { PLACE } from './checkoutFixture.js';

export type LandingServices = CommitTrees | ChangeRecord | LineWrites | FileSystem.FileSystem | CommitLandings;

export const makeCommitTrees = Effect.gen(function* () {
  const files = yield* FileSystem.FileSystem;
  const base = yield* files.makeTempDirectoryScoped({ prefix: 'tagma-commit-trees-' });
  return yield* makeGitCommitTrees({ base });
});

export const recordOver = Effect.fnUntraced(function* (
  store: MachineStore['Service'],
  units: MachineUnits['Service'],
  commands?: Parameters<typeof changeRecordOf>[4],
  walks?: Parameters<typeof changeRecordOf>[5],
) {
  const git = yield* Git;
  const paths = gitCheckoutPaths(TEST_CHECKOUT);
  return yield* changeRecordOf(store, units, paths, yield* intakeOf(store, units, git, paths), commands, walks);
});

export const landingServices = Effect.gen(function* () {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const files = yield* FileSystem.FileSystem;
  const services: Context.Context<LandingServices> = Context.make(CommitTrees, yield* makeCommitTrees).pipe(
    Context.add(ChangeRecord, yield* recordOver(store, units)),
    Context.add(LineWrites, lineWrites),
    Context.add(FileSystem.FileSystem, files),
    Context.add(CommitLandings, commitLandingsOver()),
  );
  return services;
});

const proved = (): WorkingRoot => ({ ...PLACE, generation: 0 }) as WorkingRoot;

export const provedOrigins: WorkingOrigins['Service'] = {
  of: (work) => Effect.sync(() => ({ ...proved(), work })),
  rootOf: () => Effect.sync(proved),
  placeOf: () => Effect.sync(() => PLACE),
};
