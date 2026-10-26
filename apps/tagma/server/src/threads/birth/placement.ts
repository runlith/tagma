import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Context, Data, Effect } from 'effect';
import type { SpawnWorktrees } from '@runlith/agent/collaboration/CollaborationConfig';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits, type WriteUnit } from '../../platform/contract/service/units.js';
import { Settings } from '../../settings/contract/service/values.js';
import { Coverage, FileRoots } from '../../workspace/contract/service/roots.js';
import { ThreadId } from '../../platform/contract/wire/thread.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { agentWorktrees } from '../contract/wire/settings.js';
import { worktreeBranchPrefix } from '../../worktrees/contract/wire/settings.js';
import { NewBranches } from '../../worktrees/contract/service/branches.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { FileRoot, RootBinding } from '../../workspace/contract/wire/roots.js';
import { Assignments } from '../../workspace/contract/service/assignments.js';
import { WorktreeRecords } from '../../worktrees/contract/service/worktrees.js';
import { WorktreeIntents } from '../../worktrees/contract/service/intents.js';
import { CoveredRepositories } from '../../workspace/contract/service/repositories.js';
import { Worktrees } from '../../worktrees/contract/service/creation.js';
import { UnbornReleasing } from '../../worktrees/contract/service/finishingGate.js';
import { worktreeRefusal } from '../../worktrees/contract/service/refusals.js';
import { birthRoot, type BirthPlace } from '../contract/wire/birth.js';

export const NEW_WORKTREE = 'new';

export const MAIN_WORKTREE = 'main';

export type PlacementInput = {
  readonly projectId: number;
  readonly worktree: string;
  readonly from: string | null;
  readonly operationId: string;
  readonly name: string;
  readonly base?: string;
  readonly branch?: string;
  readonly agent: boolean;
  readonly asked: boolean;
  readonly guest: boolean;
};

const hashOf = (text: string, length: number): string => createHash('sha256').update(text).digest('hex').slice(0, length);

const unplaced = (reason: string): GateRefusal<'worktree-unavailable'> =>
  new GateRefusal('worktree-unavailable', reason, [
    'list_worktrees — what this project stands on',
    'start the thread where its parent stands: omit `worktree`',
  ]);

export class PlacementRefused extends Data.TaggedError('PlacementRefused')<{ readonly refusal: GateRefusal }> {
  constructor(refusal: GateRefusal) {
    super({ refusal });
  }
  override get message(): string {
    return `${this.refusal.code}: ${this.refusal.reason} Ways on: ${this.refusal.unblock.join('; ')}`;
  }
}

export type PlacedRoot = RootBinding & { readonly made: boolean; readonly fresh: boolean };

const freshIn = (place: unknown): RootId | null =>
  typeof place === 'object' &&
  place !== null &&
  (place as { fresh?: unknown }).fresh === true &&
  typeof (place as { rootId?: unknown }).rootId === 'string'
    ? (place as { rootId: RootId }).rootId
    : null;

export const madeIn = (place: unknown): RootId | null =>
  typeof place === 'object' &&
  place !== null &&
  (place as { made?: unknown }).made === true &&
  typeof (place as { rootId?: unknown }).rootId === 'string'
    ? (place as { rootId: RootId }).rootId
    : null;

export class MadeBirths extends Context.Service<
  MadeBirths,
  {
    readonly announce: (threadId: string, rootId: RootId) => Effect.Effect<void>;
    readonly on: (listener: (threadId: string, rootId: RootId) => Effect.Effect<void>) => () => void;
  }
>()('tagma/threads/MadeBirths') {}

export const madeBirths = (): MadeBirths['Service'] => {
  const listeners = new Set<(threadId: string, rootId: RootId) => Effect.Effect<void>>();
  return MadeBirths.of({
    announce: (threadId, rootId) => Effect.forEach([...listeners], (listener) => listener(threadId, rootId), { discard: true }),
    on: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
};

export class Placing extends Context.Service<
  Placing,
  {
    asking(projectId: number): Effect.Effect<SpawnWorktrees, StoreFailure>;
    rootOf(threadId: string): Effect.Effect<RootId | null, GateRefusal>;
    rootsOf(threadId: string): Effect.Effect<readonly FileRoot[], GateRefusal>;
    resolve(ask: PlacementInput): Effect.Effect<PlacedRoot, GateRefusal>;
    abandoned(place: unknown): Effect.Effect<void>;
    born(
      unit: WriteUnit<'machine'>,
      birth: {
        readonly threadId: string;
        readonly parentThreadId: string;
        readonly lineage: 'child' | 'branch';
        readonly guest: boolean;
        readonly place?: BirthPlace;
      },
    ): Effect.Effect<void, GateRefusal>;
    planted(
      unit: WriteUnit<'machine'>,
      newborn: {
        readonly threadId: string;
        readonly root: RootBinding;
        readonly provisional?: boolean;
      },
    ): Effect.Effect<void, GateRefusal>;
  }
>()('tagma/threads/Placing') {}

export type PlacementCoordinator = Placing['Service'];

const placementUnreadable =
  (threadId: string) =>
  (failure: { readonly message: string }): GateRefusal<'placement-unreadable'> =>
    new GateRefusal('placement-unreadable', `Where thread ${threadId} stands cannot be read: ${failure.message}`, [
      'list_threads — the threads this project holds',
      'read it again once storage answers',
    ]);

export const makePlacementCoordinator = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const assignments = yield* Assignments;
  const roots = yield* FileRoots;
  const worktrees = yield* WorktreeRecords;
  const intents = yield* WorktreeIntents;
  const coverage = yield* Coverage;
  const stores = yield* CoveredRepositories;
  const acts = yield* Worktrees;
  const branches = yield* NewBranches;
  const settings = yield* Settings;
  const unborn = yield* UnbornReleasing;

  const asking = (projectId: number) => settings.value(agentWorktrees, projectId);
  const abandoned = (place: unknown) =>
    Effect.sync(() => {
      const rootId = freshIn(place);
      if (rootId !== null) unborn.release(rootId);
    });
  const planted: PlacementCoordinator['planted'] = (unit, newborn) =>
    assignments
      .place(unit, {
        threadId: ThreadId.make(newborn.threadId),
        root: { rootId: newborn.root.rootId, locationRevision: newborn.root.locationRevision },
      })
      .pipe(
        Effect.andThen(
          newborn.provisional === true ? Effect.asVoid(worktrees.nameAfter(newborn.root.rootId, newborn.threadId, unit)) : Effect.void,
        ),
        Effect.asVoid,
        Effect.mapError(
          (failure) =>
            new GateRefusal('placement-refused', `The thread could not be placed: ${failure.message}`, [
              'start it without `worktree`, or name a worktree this project answers',
            ]),
        ),
      );

  const named = Effect.fn('PlacementCoordinator.named')(function* (projectId: number, worktree: string) {
    const surveyed = yield* coverage
      .survey(projectId)
      .pipe(Effect.mapError((failure) => unplaced(`This project's checkouts cannot be read: ${failure.message}`)));
    if (worktree === MAIN_WORKTREE) {
      const canonical = surveyed.roots.find((root) => root.origin === 'canonical');
      if (canonical !== undefined) return canonical.rootId;
    }
    const listed = yield* units.read((unit) => worktrees.records(projectId, unit));
    const recorded = listed.find((record) => record.rootId === worktree || record.name === worktree);
    if (recorded !== undefined) return recorded.rootId;
    const covered = surveyed.roots.find((root) => root.rootId === worktree || basename(root.path) === worktree);
    if (covered !== undefined) return covered.rootId;
    return yield* new GateRefusal('worktree-unknown', `No worktree of this project answers to ${worktree}.`, [
      'list_worktrees — the names and root ids this project answers',
      '`new` — a fresh worktree cut from where the parent stands',
    ]);
  });

  const standing = Effect.fn('PlacementCoordinator.standing')(function* (projectId: number, threadId: string | null) {
    const canonical = (yield* coverage.covered(projectId).pipe(
      Effect.catchTag('ProjectRootsUnavailable', () => coverage.cover(projectId)),
      Effect.mapError((failure) => unplaced(`This project's checkouts cannot be read: ${failure.message}`)),
    )).rootPath;
    if (threadId === null) return canonical;
    const assignment = yield* units
      .read((unit) => assignments.read(unit, ThreadId.make(threadId)))
      .pipe(Effect.mapError((failure) => unplaced(`Where thread ${threadId} stands cannot be read: ${failure.message}`)));
    const rootId = assignment.selection.rootId;
    if (rootId === null || assignment.standing !== 'live') return canonical;
    const root = yield* roots
      .read(rootId)
      .pipe(Effect.mapError((failure) => unplaced(`The worktree thread ${threadId} stands in cannot be opened: ${failure.message}`)));
    return root.path;
  });

  const made = Effect.fn('PlacementCoordinator.made')(function* (ask: PlacementInput) {
    const policy = ask.agent ? yield* asking(ask.projectId) : 'allow';
    if (policy !== 'allow' && !ask.asked)
      return yield* new GateRefusal(
        'worktrees-ask',
        '`agent.worktrees` is ask in this project, and this road never asked the operator about a new worktree.',
        [
          'spawn the child with spawn_agent `worktree: new`, which asks',
          'name a worktree that already stands',
          'the operator switches agent.worktrees to allow',
        ],
      );
    const from = yield* standing(ask.projectId, ask.from);
    const listing = yield* stores
      .at(ask.projectId, from)
      .pipe(Effect.mapError((failure) => unplaced(`The store under ${from} cannot be read: ${failure.message}`)));
    const store = listing.repositories[0];
    if (store === undefined) return yield* unplaced(`${from} belongs to no store this project covers, so nothing can be cut from it.`);
    const start = ask.base ?? (yield* branches.start(from));
    const prefix = yield* settings.value(worktreeBranchPrefix, ask.projectId);
    const operationId = RequestKey.make(`worktree-${hashOf(ask.operationId, 24)}`);
    const caller = { projectId: ask.projectId };
    const earlier = yield* intents
      .byId(operationId)
      .pipe(Effect.mapError((failure) => unplaced(`The worktree operation ${operationId} cannot be read: ${failure.message}`)));
    const branch =
      earlier !== null && earlier.mode.kind === 'new-branch'
        ? earlier.mode.branch
        : ask.branch === undefined
          ? yield* branches.generated(from, prefix, ask.name, ask.operationId)
          : yield* branches.named(from, prefix, ask.branch);
    const created = yield* Effect.andThen(
      acts.prepare(caller, { operationId, repository: store.binding, mode: { kind: 'new-branch', branch, start } }),
      acts.create(caller, operationId),
    ).pipe(Effect.mapError(worktreeRefusal));
    if (created.status === 'ready' && created.rootId !== null) return { rootId: created.rootId, fresh: earlier === null };
    const unblock: [string, ...string[]] =
      created.status === 'failed'
        ? [`read_worktree_operation ${operationId} — what git said`, 'the creation failed and holds nothing: try again with a new request']
        : [
            `read_worktree_operation ${operationId} — what git left`,
            'a checkout that stands is taken with prepare_worktree_recovery, then adopt_worktree',
            'a creation that left nothing is released with abandon_worktree',
          ];
    return yield* new GateRefusal(
      'worktree-unresolved',
      `The worktree ${operationId} for ${branch} ended ${created.status}${created.evidence === null ? '' : `: ${created.evidence.message}`}; the thread was not placed in it.`,
      unblock,
    );
  });

  const assignmentOf = (threadId: string) =>
    units.read((unit) => assignments.read(unit, ThreadId.make(threadId))).pipe(Effect.mapError(placementUnreadable(threadId)));

  return Placing.of({
    asking,
    planted,
    abandoned,
    rootOf: (threadId) =>
      Effect.map(assignmentOf(threadId), (assignment) => (assignment.standing === 'live' ? assignment.selection.rootId : null)),
    rootsOf: (threadId) =>
      Effect.flatMap(assignmentOf(threadId), (assignment) => {
        const ids = new Set(assignment.memberships.map((membership) => membership.rootId));
        if (assignment.selection.rootId !== null) ids.add(assignment.selection.rootId);
        return ids.size === 0 ? Effect.succeed([]) : Effect.mapError(roots.live([...ids]), placementUnreadable(threadId));
      }),
    resolve: Effect.fn('PlacementCoordinator.resolve')(
      function* (ask) {
        if (ask.guest)
          return yield* new GateRefusal(
            'guest-mobility',
            'This thread works in a guest host’s world and keeps it; a registered local worktree is not a place for it.',
            ['start it without `worktree`, in the host it stands on', 'open a checkout thread for local trees'],
          );
        const { rootId, fresh } =
          ask.worktree === NEW_WORKTREE ? yield* made(ask) : { rootId: yield* named(ask.projectId, ask.worktree), fresh: false };
        const root = yield* roots.read(rootId).pipe(
          Effect.mapError((failure) => unplaced(`The worktree ${ask.worktree} cannot be opened: ${failure.message}`)),
          Effect.onError(() => (fresh ? abandoned({ rootId, fresh }) : Effect.void)),
        );
        return { rootId: root.rootId, locationRevision: root.locationRevision, made: ask.worktree === NEW_WORKTREE, fresh };
      },
      (work) =>
        Effect.mapError(work, (failure) =>
          failure instanceof GateRefusal ? failure : unplaced(`The store could not answer: ${failure.message}`),
        ),
    ),
    born: (unit, birth) => {
      if (birth.guest) return Effect.void;
      const root = birthRoot(birth.place);
      if (birth.place?.projectId !== undefined) return root === undefined ? Effect.void : planted(unit, { threadId: birth.threadId, root });
      return assignments
        .inherit(unit, {
          threadId: ThreadId.make(birth.threadId),
          parentThreadId: ThreadId.make(birth.parentThreadId),
          lineage: birth.lineage,
          root,
        })
        .pipe(
          Effect.asVoid,
          Effect.mapError(
            (failure) =>
              new GateRefusal('placement-refused', `The newborn could not be placed: ${failure.message}`, [
                birth.place === undefined
                  ? 'the parent stands in a worktree the registry no longer answers for: move it (move_thread) to one that stands, or to main'
                  : 'spawn it without `worktree`, or name a worktree this project answers',
              ]),
          ),
        );
    },
  });
});
