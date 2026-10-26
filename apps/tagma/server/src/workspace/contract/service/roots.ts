import { Context, type Effect, type FileSystem, type Result } from 'effect';
import type { IdentityWitness, NamespaceId } from '@runlith/files/namespace';
import type { LocationRevision, ResourceAddress } from '@runlith/files/resource';
import type { StoreFailure } from '../../../platform/contract/service/store.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { Unit, WriteUnit } from '../../../platform/contract/service/units.js';
import type { ProjectCoverage, ProjectRoot, ProjectRootFailure, ProjectRootsUnavailable, RootAdmission } from '../wire/coverage.js';
import type { RootId } from '../wire/ids.js';
import type {
  FileRoot,
  RootBinding,
  RootConflict,
  RootFootprint,
  RootGit,
  RootRegistration,
  RootResolutionFailure,
} from '../wire/roots.js';
import type { RootUse, RootUseFailure, UseHolder, RootUseInput, RootUseSettlementInput } from '../wire/uses.js';
import type { AcquiredEnvironment } from './environments.js';

export type DirectoryFact = {
  readonly path: string;
  readonly type: FileSystem.File.Type;
  readonly witness: IdentityWitness;
  readonly key: string;
  readonly ancestors: ReadonlySet<string>;
};

export type RootAdoption = {
  readonly root: FileRoot;
  readonly facet: RootGit | null | undefined;
  readonly checked: readonly FileRoot[];
  readonly replaced: readonly FileRoot[];
  readonly duplicate: FileRoot | null;
  readonly moved: FileRoot | null;
};

export type RootMatch = { readonly root: FileRoot; readonly path: string };

export type RootScope = {
  resolve(path: string, binding?: RootBinding): Effect.Effect<RootFootprint, RootResolutionFailure>;
};

export class FileRoots extends Context.Service<
  FileRoots,
  {
    readonly namespaceId: NamespaceId;
    register(input: RootRegistration): Effect.Effect<FileRoot, RootResolutionFailure>;
    resolve(input: RootRegistration): Effect.Effect<RootAdoption, RootResolutionFailure>;
    publish(adoption: RootAdoption, unit: WriteUnit<'machine'>): Effect.Effect<FileRoot, RootResolutionFailure>;
    publishAll(
      adoptions: readonly RootAdoption[],
      unit: WriteUnit<'machine'>,
    ): Effect.Effect<readonly Result.Result<FileRoot, RootConflict>[], RootResolutionFailure>;
    read(rootId: RootId, locationRevision?: LocationRevision): Effect.Effect<FileRoot, RootResolutionFailure>;
    checked(rootId: RootId, locationRevision?: LocationRevision, unit?: Unit<'machine'>): Effect.Effect<FileRoot, RootResolutionFailure>;
    checkedAll(bindings: readonly RootBinding[], unit?: Unit<'machine'>): Effect.Effect<readonly FileRoot[], RootResolutionFailure>;
    live(rootIds: readonly RootId[], unit?: Unit<'machine'>): Effect.Effect<readonly FileRoot[], RootResolutionFailure>;
    active(): Effect.Effect<readonly FileRoot[], RootResolutionFailure>;
    scope(): RootScope;
    resolveFootprint(path: string, binding?: RootBinding): Effect.Effect<RootFootprint, RootResolutionFailure>;
    recheck(footprint: RootFootprint, path?: string): Effect.Effect<RootFootprint, RootResolutionFailure>;
    retireMissing(rootId: RootId, unit: WriteUnit<'machine'>): Effect.Effect<FileRoot, RootResolutionFailure>;
    removed(rootId: RootId): Effect.Effect<boolean, RootResolutionFailure>;
    locate(root: FileRoot, path: string): Effect.Effect<ResourceAddress, RootResolutionFailure>;
    probe(path: string, cache?: Map<string, string>): Effect.Effect<DirectoryFact, RootResolutionFailure>;
    matching(path: string): Effect.Effect<RootMatch | null, RootResolutionFailure>;
    relocate(match: RootMatch, git?: RootGit | null): Effect.Effect<FileRoot, RootResolutionFailure>;
  }
>()('tagma/workspace/FileRoots') {}

export class RootHoldings extends Context.Service<
  RootHoldings,
  {
    has(unit: Unit<'machine'>, rootId: RootId): Effect.Effect<boolean, StoreFailure>;
  }
>()('tagma/workspace/RootHoldings') {}

export class RootUses extends Context.Service<
  RootUses,
  {
    reserve(unit: WriteUnit<'machine'>, request: RootUseInput): Effect.Effect<RootUse, RootUseFailure>;
    release(unit: WriteUnit<'machine'>, resolution: RootUseSettlementInput): Effect.Effect<RootUse, RootUseFailure>;
    forget(unit: WriteUnit<'machine'>, under: UseHolder | null, binding: RootBinding): Effect.Effect<FileRoot, RootUseFailure>;
    relocate(under: UseHolder | null, binding: RootBinding, path: string): Effect.Effect<FileRoot, RootUseFailure>;
    holding(unit: Unit<'machine'>, rootIds: readonly RootId[]): Effect.Effect<readonly RootUse[], RootUseFailure>;
  }
>()('tagma/workspace/RootUses') {}

export type RootAdmissionRequest = {
  readonly projectId: number;
  readonly footprint: RootFootprint;
  readonly acquired: AcquiredEnvironment;
};

export class Coverage extends Context.Service<
  Coverage,
  {
    cover(projectId: number): Effect.Effect<ProjectCoverage, ProjectRootFailure>;
    adopt(projectId: number, path: string): Effect.Effect<ProjectRoot, ProjectRootsUnavailable | RootResolutionFailure>;
    covered(projectId: number): Effect.Effect<ProjectCoverage, ProjectRootsUnavailable>;
    survey(projectId: number): Effect.Effect<ProjectCoverage, ProjectRootFailure>;
    admit(request: RootAdmissionRequest): Effect.Effect<RootAdmission, ProjectRootsUnavailable | RootResolutionFailure>;
    follow(projectId: number, path: string): Effect.Effect<boolean, ProjectRootsUnavailable | RootResolutionFailure>;
    followAcross(path: string): Effect.Effect<boolean, ProjectRootsUnavailable | RootResolutionFailure>;
    onCovered(listener: (projectId: number) => void): () => void;
    recorded(projectId: number): void;
  }
>()('tagma/workspace/Coverage') {}

export type ReservationHold = {
  readonly owner: string;
  readonly holder: string;
  readonly admits: readonly { readonly kind: string; readonly id: string }[];
};

export class RootReservations extends Context.Service<
  RootReservations,
  {
    holding(
      namespaceId: NamespaceId,
      paths: readonly string[],
      unit: WriteUnit<'machine'>,
    ): Effect.Effect<ReadonlyMap<string, readonly ReservationHold[]>, StoreFailure>;
  }
>()('tagma/workspace/RootReservations') {}

export class ProjectRootMembership extends Context.Service<
  ProjectRootMembership,
  {
    link(projectId: number, rootId: RootId, unit: WriteUnit<'machine'>): Effect.Effect<void, StoreFailure>;
    unlink(projectId: number, rootId: RootId, unit: WriteUnit<'machine'>): Effect.Effect<void, StoreFailure>;
  }
>()('tagma/workspace/ProjectRootMembership') {}

export class RootPublished extends Context.Service<RootPublished, { published(root: FileRoot): Effect.Effect<void, GateRefusal> }>()(
  'tagma/workspace/RootPublished',
) {}
