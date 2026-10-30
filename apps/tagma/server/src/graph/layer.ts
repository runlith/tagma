import { type Context, Effect, Layer } from 'effect';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { GraphStore, MachineStore } from '../platform/contract/service/store.js';
import type { GateRefusal } from '../platform/contract/wire/refusal.js';
import { GraphUnits } from '../platform/contract/service/units.js';
import { unitsLayer } from '../platform/store/units.js';
import type { SessionIdentity } from '../platform/contract/wire/session.js';
import { WriterRegister } from '../platform/contract/service/writers.js';
import { ownGitLayer } from '../platform/git/ownGit.js';
import { BlockRows } from './acts/rows.js';
import { actLayer } from './acts/unit.js';
import { Act, BlockNames, BlockProjection, BlockReferences } from './contract/service/acts.js';
import { documentsLayer } from './work/document.js';
import { batchLayer } from './work/Batch.js';
import { batchFilesLayer } from './work/batchFiles.js';
import { blocksLayer } from './blocks/update.js';
import { digestLayer } from './orientation/digest.js';
import { edgesLayer } from './blocks/linking.js';
import { sourcesLayer } from './sources/placement.js';
import { commitHooksLayer, graphFeedLayer } from './journal/feed.js';
import { historyLayer } from './blocks/history.js';
import { journalLayer } from './journal/eventLog.js';
import { orientationLayer } from './orientation/prime.js';
import type { GraphRole } from './serving/policy.js';
import { projectsLayer } from './serving/birth.js';
import { sessionNames } from '../thread-record/names.js';
import { SessionNames } from './contract/service/orientation.js';
import { checkoutIdentificationLayer } from '../workspace/checkouts/git.js';
import { ProjectGroups, Projects } from '../projects/contract/service/registry.js';
import { ProjectChanges } from '../projects/contract/service/changes.js';
import type { GraphServices } from './contract/service/services.js';
import { rankingLayer } from './search/ranking.js';
import { blockReadsLayer } from './reading/block.js';
import { reflectionsLayer } from './work/filedReflections.js';
import { sourceProjectLayer } from './serving/sourceProject.js';
import { selectionLayer } from './search/selection.js';
import { settingsLayer } from '../settings/layer.js';
import { settingReactionLayer } from './vocabulary/settingsReaction.js';
import { catalogInstallLayer } from './vocabulary/install.js';
import { Catalogs } from './contract/wire/catalogs.js';
import { Behaviours } from './contract/service/behaviours.js';
import type { Settings } from '../settings/contract/service/values.js';
import type { ManagedWrite } from '../settings/contract/service/managed.js';
import { DeclaredSettings, type SettingDeclarations } from '../settings/contract/service/declarations.js';
import type { SettingChanges } from '../settings/contract/service/changes.js';
import { GraphSource } from './contract/service/source.js';
import type { GraphSteps } from './contract/service/steps.js';
import type { HolderStandings } from './contract/service/holders.js';
import { writerRegisterLayer } from '../platform/store/writers.js';
import { tagsLayer } from './vocabulary/tagTable.js';
import { Tags } from './contract/service/vocabulary.js';
import { installedCatalogsLayer } from './vocabulary/catalogs.js';
import { supersessionLayer } from './work/supersession.js';
import { tasksLayer } from './work/tasks/ending.js';
import { touchesLayer } from './orientation/touches.js';
import { trashLayer } from './blocks/trash.js';
import { gitLayer } from '@runlith/git/Git';
import { ledgeredSpawner } from '../platform/git/ledgered.js';

const HOST = BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.mergeAll(BunFileSystem.layer, BunPath.layer)));
const git = ownGitLayer(gitLayer.pipe(Layer.provide(ledgeredSpawner('git').pipe(Layer.provide(HOST)))));

const sessionNamesLayer: Layer.Layer<SessionNames, never, MachineStore> = Layer.effect(
  SessionNames,
  Effect.map(MachineStore, (machine) => SessionNames.of({ of: (projectId, threadIds) => sessionNames(machine, projectId, threadIds) })),
);

type GraphNeeds =
  | GraphStore
  | MachineStore
  | SessionIdentity
  | Projects
  | ProjectGroups
  | ProjectChanges
  | Catalogs
  | Behaviours
  | GraphSource
  | GraphSteps
  | HolderStandings
  | DeclaredSettings;

type SettingsServices = Settings | SettingDeclarations | SettingChanges | ManagedWrite;

export const graphLayer = (options: {
  role?: GraphRole;
}): Layer.Layer<GraphServices, GateRefusal<'graph-pool'>, GraphNeeds | DeclaredSettings> =>
  assembled(settingsLayer.pipe(Layer.provide(settingReactionLayer)), options.role ?? 'machine');

export const mirrorGraphLayer = (
  settings: Context.Context<SettingsServices>,
): Layer.Layer<GraphServices, GateRefusal<'graph-pool'>, GraphNeeds> => assembled(Layer.succeedContext(settings), 'mirror');

const assembled = <R>(source: Layer.Layer<SettingsServices, never, R>, role: GraphRole) => {
  const acting = actLayer.pipe(Layer.provideMerge(Layer.mergeAll(writerRegisterLayer, tagsLayer, Layer.effect(Behaviours, Behaviours))));
  const shipped = Layer.merge(Layer.effect(Catalogs, Catalogs), Layer.effect(DeclaredSettings, DeclaredSettings));
  const settings = catalogInstallLayer(role === 'machine').pipe(Layer.provideMerge(Layer.mergeAll(source, shipped)));
  const configured = Layer.mergeAll(settings, installedCatalogsLayer).pipe(Layer.provideMerge(acting));
  const reading = Layer.mergeAll(projectsLayer(role), checkoutIdentificationLayer, selectionLayer, edgesLayer, trashLayer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.effect(Projects, Projects),
        Layer.effect(ProjectGroups, ProjectGroups),
        Layer.effect(ProjectChanges, ProjectChanges),
      ),
    ),
    Layer.provideMerge(configured),
    Layer.provideMerge(git),
    Layer.provide(BunFileSystem.layer),
  );
  const touching = touchesLayer.pipe(Layer.provideMerge(sessionNamesLayer), Layer.provideMerge(reading));
  const indexes = Layer.mergeAll(journalLayer, rankingLayer, sourcesLayer).pipe(Layer.provideMerge(touching));
  const tasks = tasksLayer.pipe(Layer.provideMerge(indexes));
  const writing = Layer.mergeAll(blocksLayer, historyLayer).pipe(Layer.provideMerge(tasks));
  const ending = supersessionLayer.pipe(Layer.provideMerge(writing));
  const lifecycle = Layer.mergeAll(documentsLayer, graphFeedLayer).pipe(Layer.provideMerge(ending));
  const judging = Layer.mergeAll(reflectionsLayer, sourceProjectLayer, Layer.effect(GraphSource, GraphSource)).pipe(
    Layer.provideMerge(lifecycle),
  );
  const batchFiles = batchFilesLayer.pipe(Layer.provide(BunFileSystem.layer));
  const batch = batchLayer.pipe(Layer.provideMerge(batchFiles));
  const reads = Layer.mergeAll(batch, blockReadsLayer).pipe(Layer.provideMerge(judging));
  const projecting = orientationLayer.pipe(Layer.provideMerge(reads));
  const digesting = digestLayer.pipe(Layer.provideMerge(projecting));
  return commitHooksLayer.pipe(Layer.provideMerge(digesting), Layer.provide(unitsLayer(GraphUnits, GraphStore)));
};
