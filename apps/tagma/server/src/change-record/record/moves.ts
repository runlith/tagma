import { Effect } from 'effect';
import { listingUnder, standing as standingOnDisk } from '@runlith/files/working';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';
import { chunk, unique } from '@runlith/utils/collection';
import { contentDigest } from '@runlith/files/content';
import type { Git } from '@runlith/git/Git';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { type OwnGitFailed, runGit } from '../../platform/git/ownGit.js';
import { rowsPerStatement } from '../../platform/store/binds.js';
import { standing, workspaceChange, workspaceChangeContent } from '../store/tables.js';
import type { StoreShape } from './places.js';

export const MOVED_BYTES = 64;

export const movedSize = (bytes: number | null): boolean => bytes !== null && bytes >= MOVED_BYTES;

export type Move = { readonly from: string; readonly to: string };

export type Moves = {
  readonly sourceOf: (path: string) => string | null;
  readonly partners: (path: string) => ReadonlySet<string>;
};

export type MoveReads = {
  readonly units: MachineUnits['Service'];
  readonly store: StoreShape;
  readonly git: Git['Service'];
};

export type MovePlace = { readonly checkout: string; readonly dir: string; readonly head: string | null };

const NONE: ReadonlySet<string> = new Set();

export const NO_MOVES: Moves = { sourceOf: () => null, partners: () => NONE };

const EMPTY = contentDigest('');

const PATHS_PER_STATEMENT = rowsPerStatement(3);

const DIGESTS_PER_STATEMENT = rowsPerStatement(3);

const SOURCES_AT_ONCE = 16;

const recordedMoves = (reads: MoveReads, checkout: string, paths: readonly string[]): Effect.Effect<readonly Move[], StoreFailure> =>
  Effect.map(
    Effect.forEach(chunk(paths, PATHS_PER_STATEMENT), (group) =>
      reads.units.read((unit) =>
        unit.run(
          reads.store.db
            .select({ to: workspaceChange.path, from: workspaceChange.movedFrom })
            .from(workspaceChange)
            .where(
              and(
                eq(workspaceChange.checkout, checkout),
                standing,
                isNotNull(workspaceChange.movedFrom),
                or(inArray(workspaceChange.path, group), inArray(workspaceChange.movedFrom, group)),
              ),
            ),
        ),
      ),
    ),
    (groups) => groups.flat().flatMap((row) => (row.from === null ? [] : [{ from: row.from, to: row.to }])),
  );

type Ended = {
  readonly holder: string;
  readonly path: string;
  readonly origin: string;
  readonly before: string | null;
  readonly after: string | null;
};

const bornOf = (row: Ended): string | null =>
  row.origin !== 'delete' && row.before === EMPTY && row.after !== null && row.after !== EMPTY ? row.after : null;

const goneOf = (row: Ended): string | null => (row.origin === 'delete' && row.before !== null ? row.before : null);

const sessionMoves = Effect.fn('ChangeRecord.sessionMoves')(function* (reads: MoveReads, checkout: string, paths: readonly string[]) {
  const ended = {
    holder: workspaceChange.holder,
    path: workspaceChange.path,
    origin: workspaceChange.origin,
    before: workspaceChange.beforeHash,
    after: workspaceChange.afterHash,
  };
  const at = (yield* Effect.forEach(chunk(paths, PATHS_PER_STATEMENT), (group) =>
    reads.units.read((unit) =>
      unit.run(
        reads.store.db
          .select(ended)
          .from(workspaceChange)
          .where(and(eq(workspaceChange.checkout, checkout), standing, inArray(workspaceChange.path, group))),
      ),
    ),
  )).flat();
  const digests = unique(at.flatMap((row) => [bornOf(row), goneOf(row)].filter((one): one is string => one !== null)));
  if (digests.length === 0) return [];
  const candidates = (yield* Effect.forEach(chunk(digests, DIGESTS_PER_STATEMENT), (group) =>
    reads.units.read((unit) =>
      unit.run(
        reads.store.db
          .select(ended)
          .from(workspaceChange)
          .where(
            and(
              eq(workspaceChange.checkout, checkout),
              standing,
              or(
                and(eq(workspaceChange.origin, 'delete'), inArray(workspaceChange.beforeHash, group)),
                and(eq(workspaceChange.beforeHash, EMPTY), inArray(workspaceChange.afterHash, group)),
              ),
            ),
          ),
      ),
    ),
  )).flat();
  const sides = new Map<string, { readonly born: Set<string>; readonly gone: Set<string> }>();
  for (const row of candidates) {
    const born = bornOf(row);
    const gone = goneOf(row);
    for (const [digest, side] of [
      [born, 'born'],
      [gone, 'gone'],
    ] as const) {
      if (digest === null) continue;
      const key = `${row.holder}\0${digest}`;
      const known = sides.get(key) ?? { born: new Set<string>(), gone: new Set<string>() };
      known[side].add(row.path);
      sides.set(key, known);
    }
  }
  const sizes = yield* sizesOf(reads.units, reads.store, digests);
  return [...sides].flatMap(([key, { born, gone }]) => {
    const [to] = born;
    const [from] = gone;
    const digest = key.slice(key.indexOf('\0') + 1);
    return born.size === 1 &&
      gone.size === 1 &&
      to !== undefined &&
      from !== undefined &&
      to !== from &&
      movedSize(sizes.get(digest) ?? null)
      ? [{ from, to }]
      : [];
  });
});

export const sizesOf = (
  units: MachineUnits['Service'],
  store: StoreShape,
  digests: readonly string[],
): Effect.Effect<ReadonlyMap<string, number>, StoreFailure> =>
  Effect.map(
    Effect.forEach(chunk(unique(digests), DIGESTS_PER_STATEMENT), (group) =>
      units.read((unit) =>
        unit.run(
          store.db
            .select({ digest: workspaceChangeContent.digest, bytes: workspaceChangeContent.bytes })
            .from(workspaceChangeContent)
            .where(inArray(workspaceChangeContent.digest, group)),
        ),
      ),
    ),
    (groups): ReadonlyMap<string, number> => new Map(groups.flat().map((row) => [row.digest, row.bytes] as const)),
  );

export const stagedMoves = Effect.fn('ChangeRecord.stagedMoves')(function* (
  git: Git['Service'],
  dir: string,
  head: string,
): Effect.fn.Return<readonly Move[], OwnGitFailed> {
  const fields = (yield* runGit(git, 'staged-moves', [
    '-C',
    dir,
    'diff-index',
    '--cached',
    '--find-renames=100%',
    '--diff-filter=R',
    '--name-status',
    '-z',
    head,
    '--',
  ])).split('\0');
  const moves: Move[] = [];
  for (let at = 0; at + 2 < fields.length; at += 3) moves.push({ from: fields[at + 1] as string, to: fields[at + 2] as string });
  return moves;
});

export const movesAt = Effect.fn('ChangeRecord.moves')(function* (
  reads: MoveReads,
  place: MovePlace,
  paths: readonly string[],
  staged: boolean,
): Effect.fn.Return<Moves, StoreFailure | OwnGitFailed> {
  if (paths.length === 0) return NO_MOVES;
  const asked = new Set(paths);
  const index = staged && place.head !== null ? yield* stagedMoves(reads.git, place.dir, place.head) : [];
  const found = [
    ...index.filter((move) => asked.has(move.from) || asked.has(move.to)),
    ...(yield* recordedMoves(reads, place.checkout, paths)),
    ...(yield* sessionMoves(reads, place.checkout, paths)),
  ];
  const keyed = new Map(found.filter((move) => move.from !== move.to).map((move) => [`${move.from}\0${move.to}`, move] as const));
  const listing = listingUnder(place.dir);
  const stands = yield* Effect.forEach(
    [...keyed.values()],
    (move) => Effect.map(standingOnDisk(move.from, listing), (stood) => stood !== 'absent'),
    { concurrency: SOURCES_AT_ONCE },
  );
  const sources = new Map<string, string>();
  const partners = new Map<string, Set<string>>();
  const pair = (one: string, other: string): void => {
    const known = partners.get(one);
    if (known === undefined) partners.set(one, new Set([other]));
    else known.add(other);
  };
  for (const [at, move] of [...keyed.values()].entries()) {
    if (stands[at] === true) continue;
    if (!sources.has(move.to)) sources.set(move.to, move.from);
    pair(move.to, move.from);
    pair(move.from, move.to);
  }
  return { sourceOf: (path) => sources.get(path) ?? null, partners: (path) => partners.get(path) ?? NONE };
});
