import { isAbsolute, posix, relative } from 'node:path';
import { Context, Effect } from 'effect';
import { unique } from '@runlith/utils/collection';
import type { Git } from '@runlith/git/Git';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { ChangeInput, PreparedFns, PreparedReads, PreparedRow, TeamMember } from '../contract/service/prepared.js';
import type { CommandChanges } from '../contract/service/commands.js';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import { changedWithin, standingAmong } from './eligible.js';
import { movesAt, NO_MOVES, type Moves } from '../record/moves.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type UnitsShape = Context.Service.Shape<typeof MachineUnits>;

export type Selection = {
  readonly paths: readonly string[];
  readonly unmatched: readonly string[];
  readonly moves: Moves;
};

type TeamPlace = {
  readonly git: Git['Service'];
  readonly root: string;
  readonly store: StoreShape;
  readonly units: UnitsShape;
  readonly checkout: string;
  readonly head: string | null;
};

const askedAt = (path: string, root: string): string => posix.normalize(isAbsolute(path) ? relative(root, path) : path);

const within = (path: string, asked: string): boolean => {
  const at = posix.normalize(asked).replace(/\/+$/, '');
  return at === '.' || at === '' || path === at || path.startsWith(`${at}/`);
};

const observedPaths = (commands: CommandChanges['Service'], members: readonly TeamMember[], checkout: string): readonly string[] =>
  unique(
    members.flatMap(({ projectId, threadId }) =>
      projectId === null ? [] : [...commands.retained({ projectId, threadId }, checkout).values()].map((row) => row.path),
    ),
  );

export const recordedPaths = Effect.fn('prepared.recordedPaths')(function* <Row extends PreparedRow>(
  place: TeamPlace,
  reads: PreparedReads<Row>,
  members: readonly TeamMember[],
): Effect.fn.Return<readonly string[], StoreFailure> {
  const held = yield* reads.heldPaths(
    place.units,
    place.store,
    place.checkout,
    members.map((one) => one.threadId),
  );
  return unique([...[...held.values()].flat(), ...observedPaths(reads.commands, members, place.checkout)]);
});

export const changedAmong = Effect.fn('prepared.changedAmong')(function* (
  place: { readonly git: Git['Service']; readonly root: string },
  fns: PreparedFns,
  paths: readonly string[],
): Effect.fn.Return<readonly string[]> {
  if (paths.length === 0) return [];
  return yield* fns.eligiblePaths(place.git, place.root, (yield* standingAmong(place.git, place.root, paths)).standing);
});

const recordedChanges = Effect.fn('prepared.recordedChanges')(function* <Row extends PreparedRow>(
  place: TeamPlace,
  reads: PreparedReads<Row>,
  fns: PreparedFns,
  team: readonly TeamMember[],
): Effect.fn.Return<readonly string[], StoreFailure | OwnGitFailed> {
  const recorded = yield* recordedPaths(place, reads, team);
  const changed = yield* changedAmong(place, fns, recorded);
  const seen = new Set(changed);
  const quiet = recorded.filter((path) => !seen.has(path));
  if (quiet.length === 0) return changed;
  const moves = yield* movesAt(
    { units: place.units, store: place.store, git: place.git },
    { checkout: place.checkout, dir: place.root, head: place.head },
    quiet,
    true,
  );
  const respelled = quiet.filter((path) =>
    [...moves.partners(path)].some((other) => other !== path && other.toLowerCase() === path.toLowerCase()),
  );
  return [...changed, ...respelled];
});

export const selectedPaths = Effect.fn('prepared.selected')(function* <Row extends PreparedRow>(
  place: TeamPlace,
  reads: PreparedReads<Row>,
  fns: PreparedFns,
  input: ChangeInput,
  team: readonly TeamMember[],
): Effect.fn.Return<Selection, StoreFailure | OwnGitFailed> {
  const { git, root } = place;
  const asked = input.paths?.map((one) => ({ spelled: one, at: askedAt(one, root) }));
  const inside = (asked ?? []).map((one) => one.at).filter((at) => at !== '..' && !at.startsWith('../') && !isAbsolute(at));
  const named =
    asked !== undefined
      ? inside.length === 0
        ? []
        : yield* fns.eligiblePaths(git, root, yield* changedWithin(git, root, inside))
      : input.everything === true
        ? yield* fns.eligiblePaths(git, root, yield* changedWithin(git, root, ['.']))
        : yield* recordedChanges(place, reads, fns, team);
  const moves =
    named.length === 0
      ? NO_MOVES
      : yield* movesAt(
          { units: place.units, store: place.store, git },
          { checkout: place.checkout, dir: root, head: place.head },
          named,
          true,
        );
  const chosen = new Set(named);
  const partners = unique(named.flatMap((path) => [...moves.partners(path)])).filter((path) => !chosen.has(path));
  const paths = unique([...named, ...(partners.length === 0 ? [] : yield* fns.eligiblePaths(git, root, partners))]).sort();
  const unmatched = (asked ?? [])
    .filter((one) => !paths.some((path) => within(path, one.at) || [...moves.partners(path)].some((other) => within(other, one.at))))
    .map((one) => one.spelled);
  return { paths, unmatched, moves };
});
