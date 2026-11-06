import { Effect, type FileSystem } from 'effect';
import { unique } from '@runlith/utils/collection';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import { placesIn } from '../../workspace/roots/proof.js';
import type { PreparedRow, TeamMember } from '../contract/service/prepared.js';
import { homesOfHolders } from '../record/sessions.js';
import { movesAt } from '../record/moves.js';
import { neededPaths } from './dependencies.js';
import { changedAmong, recordedPaths, type Selection } from './team.js';
import type { Landing } from './tree.js';

export type Closure<Row extends PreparedRow> = {
  readonly paths: readonly string[];
  readonly rows: ReadonlyMap<string, readonly Row[]>;
  readonly writers: ReadonlyMap<string, readonly string[]>;
};

const importing = Effect.fn('prepared.importing')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  joined: readonly string[],
  pool: readonly string[],
  capture: number,
) {
  const targets = new Set(joined);
  const found: string[] = [];
  for (const path of pool) {
    const probe = yield* Effect.result(landing.fns.walks.dependencyImports({ root: landing.root, path, capture }));
    if (probe._tag === 'Failure') {
      yield* Effect.logDebug('a writer file joins: its imports could not be read', { path, reason: probe.failure.reason });
      found.push(path);
      continue;
    }
    if (probe.success.paths.some((one) => targets.has(one))) found.push(path);
  }
  return found;
});

const standingHolders = Effect.fn('prepared.standingHolders')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  paths: readonly string[],
  rows: ReadonlyMap<string, readonly Row[]>,
  team: ReadonlySet<string>,
) {
  const holders = new Map(paths.map((path) => [path, unique((rows.get(path) ?? []).map((row) => row.threadId))] as const));
  const asked = paths.filter((path) => holders.get(path)!.some((holder) => !team.has(holder)));
  if (asked.length === 0) return holders;
  const { git, root, store, units, checkout, fns } = landing;
  const judged = yield* Effect.result(fns.judged({ git, root, store, units, checkout }, asked));
  if (judged._tag === 'Failure') {
    yield* Effect.logWarning('the recorded writers of these files are all counted: whose lines stand in them could not be judged', {
      paths: asked.length,
      reason: judged.failure.reason,
    });
    return holders;
  }
  for (const path of asked) {
    const verdict = judged.success.get(path)?.verdict;
    if (verdict?.verdict !== 'proven') continue;
    const hands = new Set(verdict.hands.map((hand) => hand.holder));
    holders.set(
      path,
      holders.get(path)!.filter((holder) => team.has(holder) || hands.has(holder)),
    );
  }
  return holders;
});

export const closed = Effect.fn('prepared.closed')(function* <Row extends PreparedRow>(
  landing: Landing<Row>,
  base: string | null,
  selection: Selection,
  capture: number,
): Effect.fn.Return<Closure<Row>, StoreFailure | OwnGitFailed, FileSystem.FileSystem> {
  const { git, root, store, units, checkout, reads, fns } = landing;
  const place = { git, root, store, units, checkout, head: base };
  const team = new Set(landing.team.map((one) => one.threadId));
  const carried = new Set(selection.paths);
  const rows = new Map<string, readonly Row[]>();
  const writers = new Map<string, readonly string[]>();
  const expanded = new Set(team);
  const homed = new Map<string, number>();
  const changes = new Map<string, readonly string[]>();
  let frontier = [...selection.paths];
  let selected = true;
  while (frontier.length > 0) {
    const grouped = yield* reads.evidenceInGroups(units, store, placesIn(checkout, frontier), (evidence) => Effect.succeed([...evidence]));
    for (const [path, held] of grouped) rows.set(path, held);
    const fresh = new Set<string>();
    const standing = yield* standingHolders(landing, frontier, rows, team);
    for (const path of frontier) {
      const found = standing.get(path) ?? [];
      writers.set(
        path,
        found.filter((holder) => !team.has(holder)),
      );
      for (const holder of found) if (!expanded.has(holder)) fresh.add(holder);
    }
    if (selected) for (const holder of fresh) expanded.add(holder);
    const unhomed = [...fresh].filter((holder) => !homed.has(holder) && !changes.has(holder));
    if (unhomed.length > 0)
      for (const [holder, home] of yield* units.read((unit) => unit.run(homesOfHolders(store, unhomed)))) homed.set(holder, home);
    for (const threadId of fresh) {
      if (changes.has(threadId)) continue;
      const member: TeamMember = { threadId, projectId: homed.get(threadId) ?? null };
      changes.set(threadId, yield* changedAmong(place, fns, yield* recordedPaths(place, reads, [member])));
    }
    const pool = unique([...fresh].flatMap((holder) => changes.get(holder) ?? [])).filter((path) => !carried.has(path));
    const theirs = selected ? pool : yield* importing(landing, frontier, pool, capture);
    selected = false;
    const needed = yield* neededPaths(landing, base, frontier, carried, capture);
    const next = unique([...theirs, ...needed]).filter((path) => !carried.has(path));
    for (const path of next) carried.add(path);
    const moves = next.length === 0 ? null : yield* movesAt({ units, store, git }, { checkout, dir: root, head: base }, next, true);
    const partners = unique(next.flatMap((path) => [...(moves?.partners(path) ?? [])])).filter((path) => !carried.has(path));
    const paired = partners.length === 0 ? [] : yield* fns.eligiblePaths(git, root, partners);
    for (const path of paired) carried.add(path);
    frontier = [...next, ...paired];
  }
  return { paths: [...carried].sort(), rows, writers };
});
