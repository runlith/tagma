import { join } from 'node:path';
import { Clock, Data, Duration, Effect } from 'effect';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Git } from '@runlith/git/Git';
import { normalizedAt, workingFilesAt } from '@runlith/git/working';
import { contentDigest, versionContentLimit } from '@runlith/files/content';
import type { LineHunk } from '@runlith/files/hunk';
import { chunk, unique } from '@runlith/utils/collection';
import type { CommandMove } from '@runlith/agent-tools/WorkspaceChanges';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { configuredGit } from '../../platform/git/ownGit.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { Hunked, HunkPair, Version, Walks } from '../lines/walks.js';
import { changeLogWrites, standing, workspaceChange } from '../store/tables.js';
import type { Decider, Life, Lives, Span } from './lives.js';
import { PLACES_PER_STATEMENT, type StoreShape, samePlaces } from './places.js';
import { versionTexts } from './evidence.js';
import { runningRunOf } from './sessions.js';
import { type RowIntake, insertRow, keepVersions } from './intake.js';
import { movedSize, sizesOf } from './moves.js';

export type CommandOpening = {
  readonly projectId: number;
  readonly threadId: string;
  readonly runHint: string | null;
  readonly spelling: string;
  readonly key: string;
};

export type Commanding = CommandOpening & { readonly windowId: string | null };

export type MoveClaim = 'mine' | 'overlap' | 'unproven' | 'other';

const pairable = (move: QueuedMove): boolean => move.claim === 'mine' || move.claim === 'overlap';

export type QueuedMove = CommandMove & { readonly claim: MoveClaim };

export type CommandEntry = Commanding & {
  readonly life: Life;
  readonly window: Span;
  readonly base: string | null;
  readonly moves: readonly QueuedMove[];
  readonly paths: ReadonlySet<string>;
  readonly release: () => void;
  readonly unwritten: (names: readonly string[], reason: string) => void;
  readonly adopted: (names: readonly string[]) => void;
};

export type CommandRowsDeps = {
  readonly store: StoreShape;
  readonly units: MachineUnits['Service'];
  readonly git: Git['Service'];
  readonly walks: Walks;
  readonly lives: Lives;
  readonly intake: RowIntake;
  readonly paths: CheckoutPaths['Service'];
  readonly patience?: Patience;
};

export class CommandRowsDelayed extends Data.TaggedError('CommandRowsDelayed')<{ readonly reason: string }> {}

type ChainRow = {
  readonly id: string;
  readonly path: string;
  readonly state: string;
  readonly origin: string;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly at: Date;
};

export type Standing = { readonly hash: string | null; readonly present: boolean };

export type Transition = { readonly from: string | null; readonly to: string; readonly at: number; readonly tail: boolean };

const PATHS_PER_UNIT = 64;

const ABSENT = contentDigest('');

export type Patience = { readonly firstMs: number; readonly lastMs: number; readonly totalMs: number };

const PATIENCE: Patience = { firstMs: 1_000, lastMs: 30_000, totalMs: 180_000 };

const persisted = (
  work: Effect.Effect<void, StoreFailure | CommandRowsDelayed>,
  entry: CommandEntry,
  names: readonly string[],
  patience: Patience,
  until: number,
  delay: number,
): Effect.Effect<void, StoreFailure> =>
  work.pipe(
    Effect.catchTag('CommandRowsDelayed', (failure) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        now + delay > until
          ? Effect.logWarning('command rows gave up and left their paths unattributed', {
              thread: entry.threadId,
              paths: names,
              reason: failure.reason,
            }).pipe(Effect.andThen(Effect.sync(() => entry.unwritten(names, failure.reason))))
          : Effect.logWarning('command rows wait for a retry', { thread: entry.threadId, reason: failure.reason }).pipe(
              Effect.andThen(Effect.sleep(Duration.millis(delay))),
              Effect.andThen(Effect.suspend(() => persisted(work, entry, names, patience, until, Math.min(delay * 2, patience.lastMs)))),
            ),
      ),
    ),
  );

const modeOf = (move: QueuedMove): string | null =>
  move.link ? '120000' : move.mode === null ? null : (move.mode & 0o111) === 0 ? '100644' : '100755';

const standingOf = (row: ChainRow): Standing => ({ hash: row.afterHash ?? ABSENT, present: row.origin !== 'delete' });

const same = (one: Standing, other: Standing): boolean => one.hash === other.hash && one.present === other.present;

export const transitionsOf = (
  rows: readonly ChainRow[],
  start: Standing,
  end: Standing & { readonly hash: string },
  window: Span,
  claimed: boolean,
): readonly Transition[] => {
  const walked = rows.filter((row) => row.at.getTime() >= window.from && row.at.getTime() <= window.to);
  const transitions: Transition[] = [];
  let version: Standing = start.hash === null ? { hash: walked[0]?.beforeHash ?? null, present: start.present } : start;
  for (const row of walked) {
    if (row.beforeHash !== null && version.hash !== null && row.beforeHash !== version.hash && !same(standingOf(row), version)) {
      transitions.push({ from: version.hash, to: row.beforeHash, at: row.at.getTime() - 1, tail: false });
    }
    version = standingOf(row);
  }
  if (claimed && !same(version, end) && !rows.some((row) => same(standingOf(row), end))) {
    transitions.push({ from: version.hash, to: end.hash, at: window.to, tail: true });
  }
  return transitions;
};

const IGNORE_CASES_KEPT = 64;

const ignoreCases = new Map<string, boolean>();

const ignoresCase = Effect.fn('CommandRows.ignoresCase')(function* (git: Git['Service'], spelling: string) {
  const known = ignoreCases.get(spelling);
  if (known !== undefined) return known;
  const said = yield* configuredGit(git, 'command-ignorecase')
    .run(['config', '--bool', 'core.ignorecase'], { cwd: spelling })
    .pipe(
      Effect.mapError((failure) => new CommandRowsDelayed({ reason: `whether git folds path case could not be read: ${failure.message}` })),
    );
  if (said.status !== 0 && said.status !== 1) {
    return yield* new CommandRowsDelayed({
      reason: `whether git folds path case could not be read: ${said.stderr.trim() || `git config exited ${said.status}`}`,
    });
  }
  const ignoring = said.status === 0 && said.stdout.trim() === 'true';
  if (ignoreCases.size >= IGNORE_CASES_KEPT) ignoreCases.delete(ignoreCases.keys().next().value as string);
  ignoreCases.set(spelling, ignoring);
  return ignoring;
});

const folded = (path: string): string => path.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const chainOf = Effect.fnUntraced(function* (
  store: StoreShape,
  checkout: string,
  places: readonly PlacedPath[],
  ignoring: boolean,
): Effect.fn.Return<ReadonlyMap<string, readonly ChainRow[]>, StoreFailure> {
  const found = new Map<string, ChainRow[]>();
  for (const group of chunk(places, PLACES_PER_STATEMENT)) {
    const rows = yield* store.db
      .select({
        id: workspaceChange.id,
        path: workspaceChange.path,
        state: workspaceChange.state,
        origin: workspaceChange.origin,
        beforeHash: workspaceChange.beforeHash,
        afterHash: workspaceChange.afterHash,
        at: workspaceChange.at,
      })
      .from(workspaceChange)
      .where(
        and(
          standing,
          ignoring
            ? and(
                eq(workspaceChange.checkout, checkout),
                inArray(sql`lower(${workspaceChange.path})`, unique(group.map((place) => folded(place.path)))),
              )
            : samePlaces(workspaceChange, group),
        ),
      )
      .orderBy(workspaceChange.at, workspaceChange.id);
    const byFold = new Map(group.map((place) => [folded(place.path), place] as const));
    for (const row of rows) {
      const place = ignoring ? byFold.get(folded(row.path)) : row;
      if (place !== undefined) found.set(place.path, [...(found.get(place.path) ?? []), row]);
    }
  }
  return found;
});

type Prepared = Hunked;

const WHOLE: Prepared = { rewritten: true, hunk: null, before: null, after: null, beforeDigest: null, afterDigest: null };

const pairKey = (path: string, from: string | null, to: string): string => `${path}\0${from ?? ''}\0${to}`;

type Base = { readonly standing: Standing; readonly version: Version | null };

export type Pairing = { readonly renames: ReadonlyMap<string, string>; readonly adopted: ReadonlySet<string> };

const UNPAIRED: Pairing = { renames: new Map(), adopted: new Set() };

const uniquely = (
  moves: readonly QueuedMove[],
  startOf: (move: QueuedMove) => Standing,
  counted: (move: QueuedMove) => boolean,
): readonly (readonly [QueuedMove, QueuedMove])[] => {
  const gone = new Map<string, QueuedMove[]>();
  const born = new Map<string, QueuedMove[]>();
  for (const move of moves) {
    if (!counted(move)) continue;
    const start = startOf(move);
    if (!move.present && start.present && start.hash !== null) gone.set(start.hash, [...(gone.get(start.hash) ?? []), move]);
    else if (move.present && !start.present) born.set(move.after, [...(born.get(move.after) ?? []), move]);
  }
  return [...born].flatMap(([digest, [to, ...more]]) => {
    const [from, ...others] = gone.get(digest) ?? [];
    return to === undefined || from === undefined || more.length > 0 || others.length > 0 ? [] : [[to, from] as const];
  });
};

export const pairingOf = (
  moves: readonly QueuedMove[],
  startOf: (move: QueuedMove) => Standing,
  sizeOf: (digest: string) => number | null,
): Pairing => {
  const renames = new Map<string, string>();
  const adopted = new Set<string>();
  for (const [to, from] of uniquely(moves, startOf, (move) => move.claim === 'mine')) renames.set(to.name, from.name);
  if (!moves.some((move) => move.claim === 'overlap')) return { renames, adopted };
  const paired = new Set([...renames.keys(), ...renames.values()]);
  for (const [to, from] of uniquely(moves, startOf, (move) => pairable(move) && !paired.has(move.name))) {
    if ((to.claim !== 'mine' && from.claim !== 'mine') || !movedSize(sizeOf(to.after))) continue;
    renames.set(to.name, from.name);
    for (const one of [to, from]) if (one.claim === 'overlap') adopted.add(one.name);
  }
  return { renames, adopted };
};

const sizeOfVersion = (version: Version | null | undefined): number | null =>
  version === null || version === undefined || 'file' in version
    ? null
    : 'bytes' in version
      ? version.bytes.byteLength
      : Buffer.byteLength(version.text, 'utf8');

export const commandRows =
  (deps: CommandRowsDeps) =>
  (entries: readonly CommandEntry[]): Effect.Effect<void, StoreFailure> =>
    Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const runId = entry.runHint ?? (yield* runningRunOf(deps.units, deps.store, entry.projectId, entry.threadId));
          const known = new Map<string, Base>();
          const adopted: string[] = [];
          let pairing: Pairing | null = null;
          for (const moves of chunk(entry.moves, PATHS_PER_UNIT)) {
            const patience = deps.patience ?? PATIENCE;
            yield* persisted(
              Effect.gen(function* () {
                pairing ??= yield* pairingOfEntry(deps, entry, known);
                adopted.push(...(yield* written(deps, entry, runId, moves, known, pairing)));
              }),
              entry,
              moves.filter((move) => move.claim === 'mine').map((move) => move.name),
              patience,
              (yield* Clock.currentTimeMillis) + patience.totalMs,
              patience.firstMs,
            );
          }
          if (adopted.length > 0) entry.adopted(adopted);
          entry.release();
        }),
      { discard: true },
    );

const basesOf = Effect.fn('CommandRows.basesOf')(function* (deps: CommandRowsDeps, entry: CommandEntry, names: readonly string[]) {
  const bases = new Map<string, Base>();
  if (names.length === 0) return bases;
  if (entry.base === null) {
    for (const name of names) bases.set(name, { standing: { hash: ABSENT, present: false }, version: { text: '' } });
    return bases;
  }
  const files = yield* workingFilesAt(configuredGit(deps.git, 'command-base'), entry.spelling, entry.base, names, {
    capture: versionContentLimit,
  });
  const contents: { readonly name: string; readonly bytes: Uint8Array }[] = [];
  for (const [at, name] of names.entries()) {
    const file = files[at];
    if (file === undefined) return yield* new CommandRowsDelayed({ reason: `git answered nothing for the committed text of ${name}` });
    if (file._tag === 'Success') {
      if (file.success === null) bases.set(name, { standing: { hash: ABSENT, present: false }, version: { text: '' } });
      else contents.push({ name, bytes: file.success });
    } else if (file.failure._tag === 'GitAnswerInvalid') bases.set(name, { standing: { hash: null, present: true }, version: null });
    else return yield* new CommandRowsDelayed({ reason: `the committed text of ${name} could not be read: ${file.failure.reason}` });
  }
  if (contents.length === 0) return bases;
  const digests = yield* deps.walks
    .digests(contents.map((one) => one.bytes))
    .pipe(Effect.mapError((unfinished) => new CommandRowsDelayed({ reason: unfinished.reason })));
  for (const [at, one] of contents.entries()) {
    bases.set(one.name, { standing: { hash: digests[at] ?? null, present: true }, version: { bytes: one.bytes } });
  }
  return bases;
});

const startOfMove =
  (bases: ReadonlyMap<string, Base>) =>
  (move: QueuedMove): Standing =>
    move.before === null
      ? (bases.get(move.name)?.standing ?? { hash: null, present: true })
      : { hash: move.before, present: move.existed ?? true };

const pairingOfEntry = Effect.fn('CommandRows.renames')(function* (deps: CommandRowsDeps, entry: CommandEntry, known: Map<string, Base>) {
  const counted = entry.moves.filter(pairable);
  const gone = counted.filter((move) => !move.present);
  const born = counted.filter((move) => move.present);
  if (gone.length === 0 || born.length === 0 || !counted.some((move) => move.claim === 'mine')) return UNPAIRED;
  const learn = (bases: ReadonlyMap<string, Base>): void => {
    for (const [name, base] of bases) known.set(name, base);
  };
  learn(
    yield* basesOf(
      deps,
      entry,
      gone.filter((move) => move.before === null && !known.has(move.name)).map((move) => move.name),
    ),
  );
  const startOf = startOfMove(known);
  const digests = new Set(gone.flatMap((move) => (startOf(move).present && startOf(move).hash !== null ? [startOf(move).hash] : [])));
  learn(
    yield* basesOf(
      deps,
      entry,
      born.filter((move) => move.before === null && digests.has(move.after) && !known.has(move.name)).map((move) => move.name),
    ),
  );
  const sizes = new Map<string, number>();
  for (const move of gone) {
    const hash = startOf(move).hash;
    const size = sizeOfVersion(known.get(move.name)?.version);
    if (hash !== null && size !== null) sizes.set(hash, size);
  }
  for (const move of born) if (move.bytes !== null) sizes.set(move.after, move.bytes.byteLength);
  const unsized = counted.some((move) => move.claim === 'overlap')
    ? [...new Set(born.map((move) => move.after))].filter((digest) => digests.has(digest) && !sizes.has(digest))
    : [];
  if (unsized.length > 0) for (const [digest, size] of yield* sizesOf(deps.units, deps.store, unsized)) sizes.set(digest, size);
  return pairingOf(counted, startOfMove(known), (digest) => sizes.get(digest) ?? null);
});

const written = Effect.fn('CommandRows.written')(function* (
  deps: CommandRowsDeps,
  entry: CommandEntry,
  runId: string | null,
  moves: readonly QueuedMove[],
  known: ReadonlyMap<string, Base>,
  { renames, adopted }: Pairing,
): Effect.fn.Return<readonly string[], StoreFailure | CommandRowsDelayed> {
  const owned = (move: QueuedMove): boolean => move.claim === 'mine' || adopted.has(move.name);
  const placed = moves.map((move) => ({ move, place: { checkout: entry.key, path: move.name } satisfies PlacedPath }));
  const places = placed.map((one) => one.place);
  const ignoring = yield* ignoresCase(deps.git, entry.spelling);
  const chains = yield* deps.units.read((unit) => unit.run(chainOf(deps.store, entry.key, places, ignoring)));
  for (const [path, rows] of chains) {
    if (rows.some((row) => row.state === 'writing'))
      return yield* new CommandRowsDelayed({ reason: `a write to ${path} is still landing` });
  }
  const bases = new Map(known);
  const read = yield* basesOf(
    deps,
    entry,
    placed
      .filter(
        ({ move, place }) => move.before === null && !known.has(move.name) && (owned(move) || (chains.get(place.path)?.length ?? 0) > 0),
      )
      .map(({ move }) => move.name),
  );
  for (const [name, base] of read) bases.set(name, base);
  const startOf = startOfMove(bases);
  const endOf = (move: QueuedMove): Standing & { readonly hash: string } => ({ hash: move.after, present: move.present });
  const decide: Decider = deps.lives.decider(entry.key, entry.life, entry.window);
  const plan = (standing: ReadonlyMap<string, readonly ChainRow[]>, move: QueuedMove, place: PlacedPath): readonly Transition[] =>
    transitionsOf(standing.get(place.path) ?? [], startOf(move), endOf(move), entry.window, owned(move)).filter(
      (transition) => transition.tail || decide({ name: move.name, after: transition.to, written: null }).kind === 'mine',
    );
  const planned = placed
    .map(({ move, place }) => ({ move, place, transitions: plan(chains, move, place) }))
    .filter((one) => one.transitions.length > 0);
  if (planned.length === 0) return [];
  const isBase = (move: QueuedMove, digest: string | null): boolean =>
    move.before === null && digest !== null && digest === startOf(move).hash;
  const stored = yield* versionTexts(
    deps.units,
    deps.store,
    planned.flatMap(({ move, transitions }) =>
      transitions.flatMap((one) => [...(one.from === null || isBase(move, one.from) ? [] : [one.from]), ...(one.tail ? [] : [one.to])]),
    ),
  );
  const versionOf = (move: QueuedMove, digest: string | null): Version | null => {
    if (digest === null) return null;
    if (isBase(move, digest)) return bases.get(move.name)?.version ?? null;
    if (digest === ABSENT && !startOf(move).present) return { text: '' };
    const text = stored.get(digest);
    return text === undefined ? null : { text };
  };
  const tailOf = (move: QueuedMove): Version | null =>
    move.link ? null : move.bytes !== null ? { bytes: move.bytes } : { file: join(entry.spelling, move.name), digest: move.after };
  const normalized = yield* normalizedAt(
    configuredGit(deps.git, 'command-eol'),
    entry.spelling,
    planned.map(({ move }) => move.name),
  ).pipe(
    Effect.mapError((failure) => new CommandRowsDelayed({ reason: `how git treats line endings could not be read: ${failure.message}` })),
  );
  const asked: { readonly key: string; readonly pair: HunkPair }[] = [];
  for (const { move, place, transitions } of planned) {
    for (const transition of transitions) {
      const deleted = transition.tail && !move.present;
      const after = transition.tail ? (deleted ? null : tailOf(move)) : versionOf(move, transition.to);
      if (!deleted && after === null) continue;
      asked.push({
        key: pairKey(place.path, transition.from, transition.to),
        pair: { before: versionOf(move, transition.from), after, normalized: normalized.has(move.name) },
      });
    }
  }
  const hunks =
    asked.length === 0
      ? []
      : yield* deps.walks
          .hunks(asked.map((one) => one.pair))
          .pipe(Effect.mapError((unfinished) => new CommandRowsDelayed({ reason: unfinished.reason })));
  const prepared = new Map<string, Prepared>(asked.map((one, at): readonly [string, Prepared] => [one.key, hunks[at] ?? WHOLE]));
  const target = yield* deps.paths
    .placeAcross(entry.spelling)
    .pipe(Effect.mapError((failure) => new CommandRowsDelayed({ reason: failure.reason })));
  if (target === null || target.checkout !== entry.key)
    return yield* new CommandRowsDelayed({ reason: `the command checkout ${entry.key} can no longer be placed at ${entry.spelling}` });
  const landed = yield* deps.units.write(changeLogWrites, () =>
    Effect.gen(function* () {
      const landed: PlacedPath[] = [];
      for (const { move, place, transitions } of planned) {
        for (const transition of transitions) {
          const ready = prepared.get(pairKey(place.path, transition.from, transition.to)) ?? WHOLE;
          const deleted = transition.tail && !move.present;
          yield* keepVersions(deps.store.db, [
            ...(transition.from !== null && ready.before !== null && ready.beforeDigest === transition.from
              ? [{ digest: transition.from, text: ready.before }]
              : []),
            ...(!deleted && ready.after !== null && ready.afterDigest === transition.to
              ? [{ digest: transition.to, text: ready.after }]
              : []),
          ]);
          yield* insertRow(deps.store.db, { projectId: entry.projectId, holder: entry.threadId }, runId, entry.base, 'held', {
            place,
            projectId: target.projectId,
            origin: deleted ? 'delete' : 'write',
            provenance: !deleted && ready.rewritten ? 'command-whole' : 'command',
            mode: transition.tail ? modeOf(move) : null,
            movedFrom: transition.tail && !deleted ? (renames.get(move.name) ?? null) : null,
            hunk: ready.hunk,
            beforeHash: transition.from,
            afterHash: transition.to,
            at: new Date(transition.at),
          });
          landed.push(place);
        }
      }
      return landed;
    }),
  );
  if (landed.length > 0) {
    yield* deps.intake.announce(target.projectId, entry.threadId, landed);
  }
  return planned.flatMap(({ move, transitions }) =>
    adopted.has(move.name) && transitions.some((transition) => transition.tail) ? [move.name] : [],
  );
});
