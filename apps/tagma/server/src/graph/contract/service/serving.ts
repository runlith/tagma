import { Context, Effect, type Scope } from 'effect';
import type { GraphStore, StoreFailure, StoreOpenFailure } from '../../../platform/contract/service/store.js';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { GraphUnits } from '../../../platform/contract/service/units.js';
import type {
  CallerRefusal,
  FloorRefusal,
  GateRefusal,
  GitRefusal,
  OpenRefusal,
  ReferenceRefusal,
} from '../../../platform/contract/wire/refusal.js';
import type { ProjectCall } from '../wire/call.js';
import type { ProjectIdentification } from '../../../projects/contract/service/registry.js';
import type { ProjectRefusal, ProjectRootFailure } from '../../../projects/contract/wire/project.js';
import type { ProjectRow, StorageMode } from '../../../projects/contract/wire/project.js';
import type { ProjectSetting, ProjectSettings } from '../wire/storage.js';
import type { ServesFrom } from '../wire/storage.js';
import type { BlockRow, TreeGuard, TreeProjection } from './acts.js';
import type { Tags } from './vocabulary.js';
import type { AdmittedProject, ProjectPolicyRow } from '../wire/serving.js';
import type { Git } from '@runlith/git/Git';
import type { ProjectBranch } from '../wire/rows.js';
import type { GraphServices } from './services.js';
import type { TopologySync } from '../../tree/topology.js';
import type { StorageLayout } from '../../storage/layout.js';
import type { ShadowGit } from '../../tree/shadow.js';
import type { TreeLedger } from '../../tree/ledger.js';
import type { TreeCommits } from '../../tree/commits.js';
import type { UnmergedTracker } from '../../../platform/git/unmerged.js';
import type { BlockTitle } from './reads.js';
import type { TreeScan } from '../../tree/scan.js';
import type { CopyFailure } from '../wire/answers.js';
import type { UnreadableCopy } from '../wire/titles.js';
import type { ForeignBlocks } from './foreign.js';
import type { SessionRef } from '../../../platform/contract/wire/session.js';

export type DetachedCheckout = { readonly checkout: string; readonly main: string };

export type CopyWriting = { readonly readOnly?: DetachedCheckout };

export type ServedPlace = CopyWriting & { readonly row: ProjectPolicyRow; readonly checkout: string };

export type IndexedCopy = {
  readonly projectId: number;
  readonly checkout: string;
  readonly branch: string | null;
  readonly canonical: boolean;
};

export type IndexedTitle = BlockTitle & IndexedCopy & { readonly trashed: boolean };

export type IndexedTitles = {
  readonly titles: readonly IndexedTitle[];
  readonly unreadable: readonly UnreadableCopy[];
  readonly unindexed: readonly IndexedCopy[];
};

export type TreeBatches = {
  readonly land: (landed: { readonly paths: readonly string[]; readonly message: string; readonly author: string }) => Effect.Effect<void>;
  readonly carry: (paths: readonly string[]) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void, GateRefusal<'graph-pool'>>;
};

export type VocabularyRefusal = FloorRefusal | 'unknown-catalog' | 'no-root' | 'field-invalid';

export type FormatHold = {
  readonly writable: Effect.Effect<void, GateRefusal<'vocabulary-newer' | 'vocabulary-older' | 'graph-pool'>>;
  readonly read: Effect.Effect<void>;
  readonly stamp: Effect.Effect<boolean, GateRefusal<'graph-pool'>>;
  readonly holds: () => boolean;
  readonly reached: () => string | null;
  readonly reach: () => void;
};

export const VocabularyFormat = Context.Reference<FormatHold | null>('tagma/graph/VocabularyFormat', {
  defaultValue: () => null,
});

export class GraphCall extends Context.Service<GraphCall, Effect.Effect<ProjectCall, GateRefusal<OpenRefusal>>>()('tagma/graph/GraphCall') {
  declare readonly placeScoped: true;
}

export class GraphScopes extends Context.Service<
  GraphScopes,
  {
    scopeByPlace(projectId: number, cwd: string): Effect.Effect<BlockRow | undefined, StoreFailure | GateRefusal<'not-found' | GitRefusal>>;
    zoneByPlace(projectId: number, place: string): Effect.Effect<BlockRow | undefined, StoreFailure>;
    placeOf(
      projectId: number,
      spelling: string,
    ): Effect.Effect<
      { place: string; symbol: string | undefined },
      StoreFailure | GateRefusal<'not-found' | 'source-outside' | GitRefusal>
    >;
    scope(
      projectId: number,
      scopeId: number,
    ): Effect.Effect<BlockRow, StoreFailure | GateRefusal<'not-found' | 'deleted' | 'scope-outside-project'>>;
    lens(input: {
      project?: string;
      cwd?: string;
      scopeName?: string;
    }): Effect.Effect<
      { projectId?: number; scopeId?: number },
      StoreFailure | GateRefusal<ReferenceRefusal | ProjectRefusal | GitRefusal | 'deleted' | 'scope-outside-project'>,
      ProjectIdentification
    >;
  }
>()('tagma/graph/GraphScopes') {}

export class ProjectPolicy extends Context.Service<
  ProjectPolicy,
  {
    read(ids: readonly number[]): Effect.Effect<ReadonlyMap<number, ProjectPolicyRow>, StoreFailure>;
    set(input: {
      ref: string;
      settings: ProjectSettings;
    }): Effect.Effect<ProjectPolicyRow, StoreFailure | GateRefusal<ProjectRefusal | FloorRefusal | 'no-root'>>;
    setStorage(input: {
      id: number;
      mode: StorageMode;
    }): Effect.Effect<ProjectPolicyRow, StoreFailure | GateRefusal<FloorRefusal | 'not-found'>>;
    setRemote(input: {
      id: number;
      remote: string | null;
    }): Effect.Effect<ProjectPolicyRow, StoreFailure | GateRefusal<FloorRefusal | 'not-found'>>;
    servesFrom(ids: readonly number[]): Effect.Effect<Map<number, ServesFrom>, StoreFailure>;
    subscribe(subscriber: (event: ProjectPolicyChanged) => Effect.Effect<void>): () => void;
  }
>()('tagma/graph/ProjectPolicy') {}

export type ProjectPolicyChanged = { readonly projectId: number; readonly field: ProjectSetting | 'storage' | 'graphRemote' };

export class ProjectLifecycle extends Context.Service<
  ProjectLifecycle,
  {
    create(
      input: {
        name: string;
        rootPath: string;
        strictProvenance?: boolean;
        private?: boolean;
        storage?: StorageMode;
        catalogs?: readonly string[];
        graphRemote?: string;
      },
      birth?: (row: ProjectPolicyRow) => Effect.Effect<void, GateRefusal<OpenRefusal>>,
    ): Effect.Effect<
      AdmittedProject,
      | StoreFailure
      | GateRefusal<
          ProjectRootFailure | VocabularyRefusal | OpenRefusal | 'reserved-project' | 'project-name' | 'duplicate-name' | 'duplicate-root'
        >,
      ProjectIdentification
    >;
    move(
      projectId: number,
      root: string,
    ): Effect.Effect<
      ProjectPolicyRow,
      | StoreFailure
      | GateRefusal<ProjectRootFailure | FloorRefusal | GitRefusal | 'not-found' | 'no-root' | 'global-permanent' | 'duplicate-root'>,
      ProjectIdentification
    >;
    update(
      input: ProjectUpdate,
    ): Effect.Effect<
      ProjectPolicyRow,
      | StoreFailure
      | GateRefusal<ProjectRefusal | FloorRefusal | 'no-root' | 'global-permanent' | 'reserved-project' | 'project-name' | 'duplicate-name'>
    >;
    remove(input: { ref: string }): Effect.Effect<ProjectPolicyRow, StoreFailure | GateRefusal>;
  }
>()('tagma/graph/ProjectLifecycle') {}

export type ProjectUpdate = { readonly ref: string; readonly name?: string; readonly settings: ProjectSettings };

export const MeasuredCheckout = Context.Reference<{
  readonly projectId: number;
  readonly path: string;
} | null>('tagma/graph/MeasuredCheckout', { defaultValue: () => null });

export const measuredRoot = (row: ProjectRow): Effect.Effect<string> =>
  Effect.map(MeasuredCheckout, (bound) => (bound !== null && bound.projectId === row.id ? bound.path : row.rootPath));

export type TreeConflict = {
  readonly path: string;
  readonly blockId: string | null;
  readonly evidence: string;
};

export const ServedTree = Context.Reference<{
  readonly treeRoot: string;
  readonly conflicts: () => Effect.Effect<readonly TreeConflict[], OwnGitFailed>;
} | null>('tagma/graph/ServedTree', {
  defaultValue: () => null,
});

export type HeldTask = { readonly name: string; readonly title: string };

export class TaskHolders extends Context.Service<
  TaskHolders,
  {
    forHolders(threadIds: readonly string[], writer?: SessionRef): Effect.Effect<ReadonlyMap<string, readonly HeldTask[]>, StoreFailure>;
  }
>()('tagma/graph/TaskHolders') {}

export type GraphContext = Context.Context<GraphServices | GraphStore | GraphUnits>;

export type ServedGraph = CopyWriting & {
  readonly context: Context.Context<GraphServices | GraphStore | GraphUnits | TaskHolders>;
  readonly git: Git['Service'];
  readonly layout: StorageLayout;
  readonly projectId: number;
  readonly checkout: string;
  readonly shadow: ShadowGit | null;
  fresh(): Effect.Effect<void, GateRefusal<OpenRefusal>>;
  copyFailures(): Effect.Effect<readonly CopyFailure[], GateRefusal<'not-served'>>;
  settled(force?: boolean): Effect.Effect<void, GateRefusal<OpenRefusal>>;
  dispose(): Effect.Effect<void>;
};

export type HeldGraph = ServedGraph & {
  readonly project: Pick<ProjectPolicyRow, 'repoKey' | 'rootPath' | 'storage'>;
  readonly batches: TreeBatches | null;
};

export type MirrorBuildInput = {
  readonly scan?: TreeScan;
  readonly rowsStep: string | null;
  readonly row: ProjectPolicyRow;
  readonly checkout: string;
  readonly layout: StorageLayout;
  readonly guard: NonNullable<Context.Service.Shape<typeof TreeGuard>>['guard'];
  readonly settled: Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly resolveProject: (projectId: number) => Effect.Effect<GraphContext, GateRefusal<OpenRefusal>>;
  readonly siblings: (place: SiblingPlace) => Effect.Effect<SiblingReading, GateRefusal<'graph-pool'>>;
  readonly committed: () => void;
  readonly temporary?: boolean;
};

export type GraphLevelInput = {
  readonly row: ProjectPolicyRow;
  readonly checkout: string;
  readonly repository: string;
  readonly commit: string;
  readonly graphPath: '' | '.tagma';
  readonly target?: string;
  readonly targetCommit?: string;
  readonly workingTree?: string;
};

export type PreparedGraph = {
  readonly built: MirrorBuilt;
  readonly layout: StorageLayout;
  readonly checkout: string;
  readonly head: string;
  readonly release: Effect.Effect<void>;
};

export type TwinLevelInput = {
  readonly row: ProjectPolicyRow;
  readonly checkout: string;
  readonly shadow: ShadowGit;
  readonly twin: string;
  readonly target: string;
};

export type SiblingPlace = {
  readonly layout: StorageLayout;
  readonly shadow: ShadowGit;
};

export type SiblingReading = {
  readonly blocked: ReadonlySet<string> | undefined;
  readonly copyFailures: readonly CopyFailure[];
};

export type MirrorBuilt = {
  readonly context: GraphContext;
  readonly poolContext: GraphContext;
  readonly shadow: ShadowGit | null;
  readonly ledger: TreeLedger;
  readonly batches: TreeBatches | null;
  readonly topology: TopologySync | null;
  readonly scope: Scope.Scope;
  readonly dispose: () => Promise<void>;
};

export type WriteBindings = {
  readonly projectId: number;
  readonly layout: StorageLayout;
  readonly ledger: TreeLedger;
  readonly commits: Context.Service.Shape<typeof TreeCommits>;
  readonly batches: TreeBatches | null;
  readonly unmerged: UnmergedTracker;
  readonly store: Context.Service.Shape<typeof GraphStore>;
  readonly tags: Context.Service.Shape<typeof Tags>;
  readonly settled: Effect.Effect<void, GateRefusal<OpenRefusal>>;
  readonly format: FormatHold;
};

export type TopologyPlace = {
  readonly row: ProjectPolicyRow;
  readonly checkout: string;
  readonly layout: StorageLayout;
  readonly shadow: ShadowGit | null;
};

export type FreshnessInit = {
  readonly checkout: string;
  readonly row: ProjectPolicyRow;
  readonly layout: StorageLayout;
  readonly shadow: ShadowGit | null;
  readonly poolContext: GraphContext;
  readonly ledger: TreeLedger;
  readonly batches: TreeBatches | null;
  readonly topology: TopologySync | null;
  readonly scope: Scope.Scope;
};

export type ServingMoveBindings = {
  readonly releaseProject: (projectId: number) => Effect.Effect<void>;
  readonly resolveFresh: (projectId: number) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
};

export type StorageMoveRefusal =
  | OpenRefusal
  | 'not-found'
  | 'storage-unchanged'
  | 'checkout-holds-tree'
  | 'detached-checkout'
  | 'tree-missing'
  | 'target-holds-tree'
  | 'tree-mid-merge';

export type CopyAim = {
  readonly projectId: number;
  readonly cwd?: string;
  readonly branch?: string;
  readonly project?: ProjectRow;
};

export type CopyPlace = { readonly projectId: number; readonly checkout: string };

export type ServedCopy = CopyPlace & { readonly treeRoot: string };

export type CopyEvent = ServedCopy & { readonly kind: 'opened' | 'closed' };

export type MirrorPlace = { readonly treeRoot: string; readonly mirrorPath: string };

export class ServedGraphs extends Context.Service<
  ServedGraphs,
  {
    resolve(input: CopyAim): Effect.Effect<ServedGraph, GateRefusal<OpenRefusal>>;
    hold(input: CopyAim): Effect.Effect<ServedGraph, GateRefusal<OpenRefusal>, Scope.Scope>;
    holdServed(place: CopyPlace): Effect.Effect<ServedGraph | null, never, Scope.Scope>;
    checkout(input: CopyAim): Effect.Effect<string, GateRefusal<CallerRefusal>>;
    held(): readonly ServedCopy[];
    readonly copies: {
      subscribe(subscriber: (event: CopyEvent) => void): () => void;
    };
    whileClosed<A, E, R>(place: MirrorPlace, work: Effect.Effect<A, E, R>): Effect.Effect<A | null, E, R>;
    titles(input: {
      readonly projectIds: readonly number[];
      readonly names: readonly string[];
      readonly excluding?: string;
      readonly settle?: boolean;
    }): Effect.Effect<IndexedTitles, GateRefusal<'graph-pool'>>;
    releaseProject(projectId: number): Effect.Effect<void>;
    birth(projectId: number): Effect.Effect<void, GateRefusal<OpenRefusal>>;
    branches(projectId: number): Effect.Effect<readonly ProjectBranch[], GateRefusal<'not-found' | 'graph-pool'>>;
    dispose(): Effect.Effect<void>;
    moveProjectStorage(input: {
      projectId: number;
      mode: StorageMode;
    }): Effect.Effect<{ readonly row: ProjectPolicyRow; readonly treeRoot: string }, GateRefusal<StorageMoveRefusal>>;
    release(place: CopyPlace): Effect.Effect<void>;
  } & ForeignBlocks
>()('tagma/graph/ServedGraphs') {}

export const RoutedGraphs = Context.Reference<ServedGraphs['Service'] | null>('tagma/graph/RoutedGraphs', {
  defaultValue: () => null,
});

export const CurrentGraph = Context.Reference<ServedGraph | null>('tagma/graph/CurrentGraph', {
  defaultValue: () => null,
});

export const RefusedGraph = Context.Reference<GateRefusal | null>('tagma/graph/RefusedGraph', {
  defaultValue: () => null,
});

export class FreshnessGate extends Context.Service<
  FreshnessGate,
  {
    readonly register: (treeRoot: string, init: FreshnessInit) => Effect.Effect<{ readonly unregister: () => void }, never>;
    readonly fresh: (treeRoot: string) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
    readonly settled: (treeRoot: string, force?: boolean) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
    readonly close: (treeRoot: string) => Effect.Effect<void>;
    readonly beforeAct: (treeRoot: string) => Effect.Effect<void, GateRefusal<OpenRefusal>>;
    readonly topology: (treeRoot: string) => Effect.Effect<TopologySync | null, GateRefusal<OpenRefusal>>;
    readonly copyFailures: (treeRoot: string) => Effect.Effect<readonly CopyFailure[], GateRefusal<'not-served'>>;
    readonly prepareTopology: (place: TopologyPlace) => Effect.Effect<TopologySync | null, GateRefusal<'graph-pool'>>;
    readonly siblings: (place: SiblingPlace) => Effect.Effect<SiblingReading, GateRefusal<'graph-pool'>>;
    readonly remoteMoved: (gitDir: string) => void;
  }
>()('tagma/graph/FreshnessGate') {}

export class MirrorBuilder extends Context.Service<
  MirrorBuilder,
  {
    readonly build: (input: MirrorBuildInput) => Effect.Effect<MirrorBuilt, GateRefusal<OpenRefusal>>;
    readonly level: (input: TwinLevelInput) => Effect.Effect<string, GateRefusal<OpenRefusal>>;
    readonly prepare: (input: GraphLevelInput) => Effect.Effect<PreparedGraph, GateRefusal<OpenRefusal>>;
    readonly writeThrough: (bind: WriteBindings) => Effect.Effect<TreeProjection>;
    readonly syncRegistry: (context: GraphContext) => Effect.Effect<void, StoreFailure>;
    readonly registrySynced: (context: GraphContext) => Effect.Effect<boolean>;
    readonly forgetRegistry: (context: GraphContext) => Effect.Effect<void>;
    readonly travelMirror: (from: string, to: string, treeRoot: string) => Effect.Effect<void, StoreOpenFailure>;
  }
>()('tagma/graph/MirrorBuilder') {}

export class ServingSwitch extends Context.Service<
  ServingSwitch,
  {
    readonly servedBy: (input: {
      readonly projectId: number;
      readonly cwd?: string;
      readonly branch?: string;
      readonly project?: ProjectRow;
    }) => Effect.Effect<ServedPlace, GateRefusal<CallerRefusal>>;
    readonly branches: (projectId: number) => Effect.Effect<readonly ProjectBranch[], GateRefusal<'not-found' | 'graph-pool'>>;
    readonly move: (
      input: { readonly projectId: number; readonly mode: StorageMode },
      bindings: ServingMoveBindings,
    ) => Effect.Effect<{ readonly row: ProjectPolicyRow; readonly treeRoot: string }, GateRefusal<StorageMoveRefusal>>;
  }
>()('tagma/graph/ServingSwitch') {}
