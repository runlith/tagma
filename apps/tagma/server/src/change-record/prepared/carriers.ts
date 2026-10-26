import { isAbsolute, posix, relative } from 'node:path';
import { Context, Effect } from 'effect';
import { unique } from '@runlith/utils/collection';
import type { Git } from '@runlith/git/Git';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { ChangeInput, LandingOrigin, PreparedFns, PreparedReads, PreparedRow } from '../contract/service/prepared.js';
import type { ChangeTaking } from '../contract/wire/handover.js';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { holdersOf } from '../holdings/totals.js';
import { changedWithin, standingAmong } from './eligible.js';
import { movesAt, NO_MOVES } from '../record/moves.js';
import { TEAM_REASON } from '../contract/service/commands.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

type UnitsShape = Context.Service.Shape<typeof MachineUnits>;

export type Selection = {
  readonly paths: readonly string[];
  readonly explicit: ReadonlySet<string>;
  readonly unmatched: readonly string[];
  readonly unattributed: readonly string[];
  readonly pairs: ReadonlyMap<string, ReadonlySet<string>>;
};

export const carriersOf = (origin: LandingOrigin, input: Pick<ChangeInput, 'taking'>): readonly ChangeTaking[] => {
  const carriers = new Map<string, ChangeTaking>(origin.work === null ? [] : [[origin.work.threadId, origin.work]]);
  for (const taking of input.taking) if (!carriers.has(taking.threadId)) carriers.set(taking.threadId, taking);
  return [...carriers.values()];
};

export const bearsNobody = (origin: LandingOrigin, explicit: ReadonlySet<string>, path: string): boolean =>
  origin.work === null && explicit.has(path);

const askedAt = (path: string, root?: string): string =>
  posix.normalize(isAbsolute(path) && root !== undefined ? relative(root, path) : path);

const within = (path: string, asked: string): boolean => {
  const at = posix.normalize(asked).replace(/\/+$/, '');
  return at === '.' || at === '' || path === at || path.startsWith(`${at}/`);
};

export const wholeAt = (whole: readonly string[] | undefined, path: string, root?: string): boolean =>
  whole?.some((one) => within(path, askedAt(one, root))) ?? false;

const anyOf = (paths: ReadonlySet<string>, test: (path: string) => boolean): boolean => {
  for (const path of paths) if (test(path)) return true;
  return false;
};

export const heldPaths = Effect.fn('prepared.heldPaths')(function* <Row extends PreparedRow>(
  git: Git['Service'],
  root: string,
  store: StoreShape,
  units: UnitsShape,
  reads: PreparedReads<Row>,
  fns: PreparedFns,
  checkout: string,
  head: string | null,
  input: Pick<ChangeInput, 'paths' | 'taking'>,
  carriers: readonly ChangeTaking[],
  own: string | null,
): Effect.fn.Return<Selection, StoreFailure | OwnGitFailed | GateRefusal<'walk-cut'>> {
  const recorded = unique(
    (yield* Effect.forEach(carriers, (who) =>
      Effect.map(reads.pathsOfThread(units, store, who.projectId, who.threadId, checkout), (rows) => rows.map((row) => row.path)),
    )).flat(),
  );
  const retainedOf = ({ projectId, threadId }: ChangeTaking) =>
    projectId === null ? [] : [...reads.commands.retained({ projectId, threadId }, checkout).values()];
  const taken = carriers.filter((who) => who.threadId !== own);
  const retained = unique(carriers.flatMap(retainedOf).map((row) => row.path));
  const teamOnly = (path: string): boolean =>
    reads.commands.unattributedUnder(checkout, path).every((row) => row.path !== path || (row.reason === TEAM_REASON && row.team === own));
  const team = unique(
    taken
      .flatMap(retainedOf)
      .filter((row) => own !== null && row.reason === TEAM_REASON && row.team === own)
      .map((row) => row.path),
  ).filter(teamOnly);
  const asked = input.paths?.map((one) => ({ spelled: one, at: askedAt(one, root) }));
  const inside = (asked ?? []).map((one) => one.at).filter((at) => at !== '..' && !at.startsWith('../') && !isAbsolute(at));
  const explicit = inside.length === 0 ? [] : [...(yield* fns.eligiblePaths(git, root, yield* changedWithin(git, root, inside)))];
  const known = unique([...recorded, ...retained, ...explicit]);
  const moves = known.length === 0 ? NO_MOVES : yield* movesAt({ units, store, git }, { checkout, dir: root, head }, known, true);
  const namedAt = (path: string): boolean => asked?.some((name) => within(path, name.at)) ?? false;
  const named = (path: string): boolean => asked === undefined || namedAt(path) || anyOf(moves.partners(path), namedAt);
  const candidates = yield* fns.eligiblePaths(git, root, recorded.filter(named));
  const judged = yield* fns.judged({ git, root, store, units, checkout }, candidates);
  const holders = new Set(carriers.map((who) => who.threadId));
  const held: string[] = [];
  for (const path of candidates) {
    const one = judged.get(path);
    if (one === undefined)
      return yield* new GateRefusal(
        'walk-cut',
        `whose lines stand in ${path} was not answered, so the landing selection cannot be determined`,
        ['submit again once the record and the checkout answer', `name paths excluding ${path} to select the rest of the work`],
      );
    if (holdersOf(one.holding).some((holder) => holders.has(holder))) held.push(path);
  }
  const retainedHere = (asked ?? []).length === 0 ? [] : retained.filter(named);
  const selected = unique([...held, ...retainedHere, ...team.filter(named), ...explicit]);
  const paired = unique([...selected, ...selected.flatMap((path) => [...moves.partners(path)])]);
  const vetted = new Set([...candidates, ...explicit]);
  const paths = [
    ...paired.filter((path) => vetted.has(path)),
    ...(yield* fns.eligiblePaths(
      git,
      root,
      paired.filter((path) => !vetted.has(path)),
    )),
  ].sort();
  const unmatched = (asked ?? [])
    .filter((one) => !paths.some((path) => within(path, one.at) || anyOf(moves.partners(path), (other) => within(other, one.at))))
    .map((one) => one.spelled);
  const carried = new Set(paths);
  const pairs = new Map<string, ReadonlySet<string>>();
  for (const path of paths) {
    const partners = [...moves.partners(path)].filter((one) => carried.has(one));
    if (partners.length > 0) pairs.set(path, new Set(partners));
  }
  const leftBehind = retained.filter((path) => !carried.has(path));
  const unattributed = leftBehind.length === 0 ? [] : [...(yield* standingAmong(git, root, leftBehind)).standing].sort();
  return { paths, explicit: new Set([...retainedHere, ...explicit]), unmatched, unattributed, pairs };
});
