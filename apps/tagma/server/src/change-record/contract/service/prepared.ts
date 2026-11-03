import { Context, Data, type Effect } from 'effect';
import type { Git } from '@runlith/git/Git';
import type { TreeEntry } from '@runlith/git/entries';
import type { MachineStore, StoreFailure } from '../../../platform/contract/service/store.js';
import type { OwnGitFailed } from '../../../platform/git/ownGit.js';
import type { GitPlaces } from '../../../platform/git/places.js';
import type { MachineUnits } from '../../../platform/contract/service/units.js';
import type { GateRefusal } from '../../../platform/contract/wire/refusal.js';
import type { ActorRef } from '../../../platform/contract/wire/actor.js';
import type { PlacedPath, WorkingRoot, WorkOrigin } from '../../../workspace/contract/wire/place.js';
import type { CommandChanges } from './commands.js';
import type { Reshaped } from '../wire/reshape.js';
import type { ShapeRefusal } from '../wire/shape.js';
import type { Judged } from './holdings.js';
import type { Walks } from '../../lines/walks.js';
import type { DeriveCommand } from '../wire/derivation.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type UnitsShape = Context.Service.Shape<typeof MachineUnits>;

export type LandingOrigin = WorkingRoot & { readonly work: WorkOrigin | null };

export type TeamMember = { readonly projectId: number | null; readonly threadId: string };

export type ChangeInput = {
  readonly paths?: readonly string[];
  readonly everything?: boolean;
  readonly withoutFormat?: boolean;
  readonly derive?: readonly DeriveCommand[];
};

export type PreparedPlan = { readonly path: string; readonly writers: readonly string[]; readonly ids: readonly string[] };

export type PreparedHashes = {
  readonly carried: ReadonlySet<string>;
  readonly peers: ReadonlySet<string>;
};

export type PreparedEntries = {
  readonly base: string | null;
  readonly tree: string;
  readonly before: ReadonlyMap<string, TreeEntry | null>;
  readonly after: ReadonlyMap<string, TreeEntry | null>;
};

export type PreparedBuilt = {
  readonly base: string | null;
  readonly tree: string;
  readonly from: string;
  readonly changed: readonly string[];
  readonly entries: PreparedEntries;
  readonly plan: readonly PreparedPlan[];
  readonly hashes: ReadonlyMap<string, PreparedHashes>;
  readonly reshaped: readonly Reshaped[];
  readonly formatSkipped: boolean;
  readonly declaration: readonly string[];
  readonly derived?: readonly string[];
};

export type PreparedMerge = {
  readonly parents: readonly string[];
  readonly tree: string;
};

export type PreparedChange<Caller> = {
  readonly subject: PreparedSubject<Caller>;
  readonly built: PreparedBuilt;
  readonly index: string;
  readonly merge?: PreparedMerge;
  readonly beside?: 'merge';
};

export type PreparedLanding<Caller> = PreparedChange<Caller> & { readonly places: GitPlaces; readonly ref: string };

export type PreparedLine = { readonly file: string; readonly line: number };

export class LinesUnread extends Data.TaggedError('LinesUnread')<{ readonly reason: string }> {}

export type PreparedLineHolders = (lines: readonly PreparedLine[]) => Effect.Effect<readonly (readonly string[])[], LinesUnread>;

export type PreparedHold = { readonly _tag: 'missing' } | { readonly _tag: 'stands'; readonly writers: readonly string[] };

export class WorkingPathUnread extends Data.TaggedError('WorkingPathUnread')<{
  readonly path: string;
  readonly reason: string;
}> {}

export type PreparedHolds = (paths: readonly string[]) => Effect.Effect<readonly PreparedHold[], StoreFailure | WorkingPathUnread>;

export type PreparedSubject<Caller> = {
  readonly kind: 'tree';
  readonly projectId: number;
  readonly root: string;
  readonly commonDir?: string;
  readonly base: string;
  readonly built: string;
  readonly merged?: readonly string[];
  readonly paths: readonly string[];
  readonly holders?: PreparedLineHolders;
  readonly holds?: PreparedHolds;
  readonly caller?: Caller;
  readonly job?: string;
};

export type PrepareInput<Caller> = {
  readonly projectId: number;
  readonly git: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: UnitsShape;
  readonly origin: LandingOrigin;
  readonly checkout: string;
  readonly input: ChangeInput;
  readonly job: string;
  readonly caller: Caller;
  readonly act: ActorRef;
};

export type PreparedRow = {
  readonly id: string;
  readonly threadId: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly unresolved: boolean;
};

export type PreparedPlace = {
  readonly git: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: UnitsShape;
  readonly checkout: string;
};

export type PreparedFns = {
  readonly judged: (place: PreparedPlace, paths: readonly string[]) => Effect.Effect<ReadonlyMap<string, Judged>, LinesUnread>;
  readonly eligiblePaths: (git: Git['Service'], root: string, paths: readonly string[]) => Effect.Effect<readonly string[]>;
  readonly pathChunks: (paths: readonly string[]) => readonly (readonly string[])[];
  readonly walks: Walks;
};

export type PreparedReads<Row extends PreparedRow> = {
  readonly commands: CommandChanges['Service'];
  readonly team: (units: UnitsShape, store: StoreShape, work: WorkOrigin) => Effect.Effect<readonly TeamMember[], StoreFailure>;
  readonly heldPaths: (
    units: UnitsShape,
    store: StoreShape,
    checkout: string,
    holders: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, readonly string[]>, StoreFailure>;
  readonly heldCheckouts: (
    units: UnitsShape,
    store: StoreShape,
    holders: readonly string[],
  ) => Effect.Effect<readonly string[], StoreFailure>;
  readonly evidenceInGroups: <A, E>(
    units: UnitsShape,
    store: StoreShape,
    places: readonly PlacedPath[],
    use: (evidence: ReadonlyMap<string, readonly Row[]>) => Effect.Effect<readonly A[], E>,
  ) => Effect.Effect<readonly A[], E | StoreFailure>;
};

export type PreparedRefusal =
  | 'no-record'
  | 'no-branch'
  | 'git-unavailable'
  | 'git-not-admitted'
  | 'tree-mid-merge'
  | 'path-unread'
  | 'landing-busy'
  | ShapeRefusal;

export type PreparedEmptied = {
  readonly base: string | null;
  readonly reshaped: readonly Reshaped[];
  readonly ids: readonly string[];
};

export type PreparedOutcome<Caller> = {
  readonly prepared: PreparedLanding<Caller> | null;
  readonly emptied: PreparedEmptied | null;
  readonly team: readonly TeamMember[];
  readonly unmatched: readonly string[];
  readonly paths: readonly string[];
  readonly unattributed: readonly string[];
};

export class PreparedChanges extends Context.Service<
  PreparedChanges,
  {
    prepare<Caller>(
      args: PrepareInput<Caller>,
    ): Effect.Effect<PreparedOutcome<Caller>, OwnGitFailed | GateRefusal<PreparedRefusal> | StoreFailure>;
    rebase<Caller>(
      git: Git['Service'],
      root: string,
      prepared: PreparedLanding<Caller>,
      head: string,
    ): Effect.Effect<PreparedLanding<Caller> | null, OwnGitFailed>;
    release(prepared: PreparedChange<unknown>): Effect.Effect<void>;
    remaining(place: PreparedPlace, team: readonly TeamMember[]): Effect.Effect<readonly string[], StoreFailure | OwnGitFailed>;
    teamCheckouts(
      units: UnitsShape,
      store: StoreShape,
      work: WorkOrigin,
    ): Effect.Effect<{ readonly team: readonly TeamMember[]; readonly checkouts: readonly string[] }, StoreFailure>;
    carriedBy(place: PreparedPlace, team: readonly TeamMember[]): Effect.Effect<readonly string[], StoreFailure>;
  }
>()('tagma/change-record/PreparedChanges') {}
