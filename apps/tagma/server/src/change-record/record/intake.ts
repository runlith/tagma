import { lstat } from 'node:fs/promises';
import type { GitMetadata } from './metadata.js';
import { Clock, Context, Effect, Option, Semaphore } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { IntakeRefused, type Landed } from '@runlith/agent-tools/WorkspaceChanges';
import { contentDigest } from '@runlith/files/content';
import { Git } from '@runlith/git/Git';
import { normalizedAt } from '@runlith/git/working';
import { troubleOf } from '@runlith/git/repository';
import { configuredGit } from '../../platform/git/ownGit.js';
import type { ChangeTarget } from '@runlith/files/change';
import type { LineHunk } from '@runlith/files/hunk';
import { chunk } from '@runlith/utils/collection';
import { MachineStore, type StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckoutRows, GraphDirectory } from '../../workspace/contract/service/checkouts.js';
import { CheckoutPaths, type CheckoutPlace } from '../../workspace/contract/service/checkoutPaths.js';
import type { PlacedPath } from '../../workspace/contract/wire/place.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import { HeldFeed } from '../contract/service/held.js';
import type { IntakeFact, IntakeWork } from '../contract/service/intake.js';
import type { Walks } from '../lines/walks.js';
import { changeLogWrites, held, workspaceChange, workspaceChangeContent, type RowState } from '../store/tables.js';
import type { Heads } from './heads.js';
import { BaseTexts, joinable, joined, type Joining, type Windowed } from './joining.js';
import type { InstantMark, Lives } from './lives.js';
import { PLACES_PER_STATEMENT, placeKey, samePlaces } from './places.js';
import { runningRunOf } from './sessions.js';
import { releaseVersions } from './versions.js';
import { putHunkText } from './hunks.js';

export type RowHolder = { readonly projectId: number; readonly holder: string };

const OPERATOR_KEY = holderKey(OPERATOR);

export type Version = { readonly digest: string; readonly text: string };

export type RowFact = {
  readonly place: PlacedPath;
  readonly projectId: number;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly provenance?: NonNullable<typeof workspaceChange.$inferSelect.provenance>;
  readonly mode: string | null;
  readonly hunk: LineHunk | null;
  readonly beforeHash: string | null;
  readonly afterHash: string | null;
  readonly at: Date;
  readonly movedFrom?: string | null;
  readonly reverts?: readonly string[] | null;
  readonly key?: string | null;
};

type Placed = { readonly fact: IntakeFact; readonly place: CheckoutPlace };

type WriteBasis = {
  readonly places: ReadonlyMap<string, CheckoutPlace | null>;
  readonly heads: ReadonlyMap<string, string | null>;
  readonly normalized: ReadonlyMap<string, boolean>;
};

type NormalizationGroup = { readonly root: string; readonly paths: Map<string, string> };

const WriteBasis = Context.Reference<WriteBasis | null>('change-record/WriteBasis', { defaultValue: () => null });

export const keepVersions = Effect.fnUntraced(function* (db: MachineStore['Service']['db'], versions: readonly Version[]) {
  if (versions.length === 0) return;
  const at = new Date(yield* Clock.currentTimeMillis);
  yield* db
    .insert(workspaceChangeContent)
    .values(
      versions.map((version) => ({
        digest: version.digest,
        text: version.text,
        bytes: Buffer.byteLength(version.text, 'utf8'),
        at,
      })),
    )
    .onConflictDoNothing();
});

export const insertRow = Effect.fnUntraced(function* (
  db: MachineStore['Service']['db'],
  work: RowHolder,
  runId: string | null,
  head: string | null,
  state: RowState,
  row: RowFact,
): Effect.fn.Return<string | null, StoreFailure> {
  const rows = yield* db
    .insert(workspaceChange)
    .values({
      projectId: row.projectId,
      holderProjectId: work.holder === OPERATOR_KEY ? null : work.projectId,
      holder: work.holder,
      runId,
      checkout: row.place.checkout,
      path: row.place.path,
      movedFrom: row.movedFrom ?? null,
      head,
      state,
      origin: row.origin,
      provenance: row.provenance ?? 'typed',
      mode: row.mode,
      firstLine: row.hunk?.firstLine ?? null,
      lines: row.hunk?.newLines ?? null,
      oldLines: row.hunk?.oldLines ?? null,
      windowBefore: row.hunk?.windowBefore ?? null,
      reverts: row.reverts ?? null,
      beforeHash: row.beforeHash,
      afterHash: row.origin === 'delete' ? null : row.afterHash,
      recordKey: row.key ?? crypto.randomUUID(),
      at: row.at,
    })
    .onConflictDoNothing({ target: [workspaceChange.holder, workspaceChange.recordKey] })
    .returning({ id: workspaceChange.id });
  const id = rows[0]?.id ?? null;
  const oldText = row.hunk?.oldText ?? null;
  const newText = row.origin === 'delete' ? null : (row.hunk?.newText ?? null);
  if (id !== null && (oldText !== null || newText !== null)) yield* putHunkText(db, id, oldText, newText);
  return id;
});

const provenPair = (digest: string | undefined, text: string | undefined): Version | undefined =>
  digest === undefined || text === undefined || contentDigest(text) !== digest ? undefined : { digest, text };

const versionsOf = (fact: IntakeFact): readonly Version[] =>
  [provenPair(fact.before, fact.beforeText), ...(fact.origin === 'delete' ? [] : [provenPair(fact.after, fact.afterText)])].filter(
    (version): version is Version => version !== undefined,
  );

const modeAt = Effect.fnUntraced(function* (path: string) {
  const read = yield* Effect.result(Effect.tryPromise(() => lstat(path)));
  if (read._tag === 'Failure') {
    yield* Effect.logWarning('a write is recorded without its file mode: its file could not be read', {
      path,
      reason: read.failure.message,
    });
    return null;
  }
  const info = read.success;
  return info.isSymbolicLink() ? '120000' : info.isFile() ? ((info.mode & 0o111) === 0 ? '100644' : '100755') : null;
});

const refusal = (path: string) => (failure: { readonly message: string }) => new IntakeRefused({ path, reason: failure.message });

type Intended = {
  readonly holder: RowHolder;
  readonly ids: readonly { readonly id: string; readonly placed: Placed }[];
  readonly marks: readonly InstantMark[];
};

const rowHolder = (work: IntakeWork): RowHolder => ({ projectId: work.projectId, holder: holderKey(work.holder) });

type Turn = { readonly permits: Semaphore.Semaphore; users: number };

type Placing = { readonly place: CheckoutPlace; users: number };

const spellingKey = (projectId: number, path: string, target: ChangeTarget): string => `${projectId}\0${target}\0${path}`;

export type RowIntake = Effect.Success<ReturnType<typeof makeRowIntake>>;

export const makeRowIntake = Effect.fnUntraced(function* ({
  lives,
  walks,
  heads,
  metadata,
}: {
  readonly lives: Lives;
  readonly walks: Walks;
  readonly heads: Heads;
  readonly metadata: GitMetadata;
}) {
  const store = yield* MachineStore;
  const units = yield* MachineUnits;
  const paths = yield* CheckoutPaths;
  const git = configuredGit(yield* Git, 'intake-normalization');
  const graphDirectory = yield* GraphDirectory;
  const checkouts = yield* Effect.serviceOption(CheckoutRows);
  const feed = yield* Effect.serviceOption(HeldFeed);
  const turns = new Map<string, Turn>();
  const placing = new Map<string, Placing>();
  const graphs = new Set<string>();
  const bases = new BaseTexts();
  let unjoined = 0;

  const placeOf = Effect.fnUntraced(function* (
    projectId: number,
    path: string,
    target: ChangeTarget = 'entry',
  ): Effect.fn.Return<CheckoutPlace | null, IntakeRefused> {
    const basis = yield* WriteBasis;
    const key = spellingKey(projectId, path, target);
    if (basis?.places.has(key)) return basis.places.get(key) ?? null;
    return yield* Effect.suspend(() => {
      const standing = placing.get(key);
      if (standing !== undefined) return Effect.succeed(standing.place);
      if (target === 'entry') for (const graph of graphs) if (path.startsWith(graph)) return Effect.succeed(null);
      const locating = target === 'entry' ? paths.placeAcross(path) : paths.resourceAcross(path);
      return Effect.flatMap(Effect.mapError(locating, refusal(path)), (place) => {
        if (place === null) return Effect.succeed(null);
        graphs.add(`${place.root}/${graphDirectory}/`);
        if (place.path === '' || place.path === graphDirectory || place.path.startsWith(`${graphDirectory}/`)) return Effect.succeed(null);
        return Effect.map(
          metadata.contains(place.root, place.path).pipe(Effect.mapError((failure) => new IntakeRefused({ path, reason: failure.reason }))),
          (inside) => (inside ? null : place),
        );
      });
    });
  });

  const holdersOf = (places: readonly PlacedPath[]): Effect.Effect<readonly string[], StoreFailure> =>
    units.read((unit) =>
      Effect.gen(function* () {
        const holders: string[] = [];
        for (const group of chunk(places, PLACES_PER_STATEMENT)) {
          const rows = yield* unit.run(
            store.db
              .selectDistinct({ holder: workspaceChange.holder })
              .from(workspaceChange)
              .where(and(samePlaces(workspaceChange, group), held)),
          );
          for (const row of rows) holders.push(row.holder);
        }
        return holders;
      }),
    );

  const announce = (projectId: number, holder: string, places: readonly PlacedPath[]): Effect.Effect<void> => {
    const unique = [...new Map(places.map((place) => [placeKey(place), place] as const)).values()];
    if (unique.length === 0) return Effect.void;
    return Effect.gen(function* () {
      if (Option.isSome(checkouts)) {
        const byCheckout = new Map<string, string[]>();
        for (const place of unique) byCheckout.set(place.checkout, [...(byCheckout.get(place.checkout) ?? []), place.path]);
        yield* Effect.forEach(byCheckout, ([checkout, marked]) => checkouts.value.mark(checkout as RootId, 'written', marked), {
          discard: true,
        });
      }
      if (Option.isNone(feed)) return;
      const holders = yield* Effect.result(holdersOf(unique));
      if (holders._tag === 'Failure') {
        yield* Effect.logWarning('a write was told to its own thread only: who else holds its paths could not be read', {
          reason: holders.failure.message,
        });
      }
      const told = new Set(
        [holder, ...(holders._tag === 'Success' ? holders.success : [])].map((one) => (one === OPERATOR_KEY ? null : one)),
      );
      yield* Effect.forEach(told, (threadId) => feed.value.publish({ threadId, moved: { projectId, places: unique } }), {
        discard: true,
      });
    });
  };

  const announcePlaced = (holder: string, placed: readonly Placed[]): Effect.Effect<void> => {
    const byProject = new Map<number, PlacedPath[]>();
    for (const { place } of placed) {
      const group = byProject.get(place.projectId);
      if (group === undefined) byProject.set(place.projectId, [place]);
      else group.push(place);
    }
    return Effect.forEach(byProject, ([projectId, places]) => announce(projectId, holder, places), { discard: true });
  };

  const placedOf = (projectId: number, facts: readonly IntakeFact[]): Effect.Effect<readonly Placed[], IntakeRefused> =>
    Effect.map(
      Effect.forEach(facts, (fact) => {
        const target = fact.target ?? (fact.origin === 'delete' || fact.mode === '120000' ? 'entry' : 'resource');
        return Effect.map(placeOf(projectId, fact.path, target), (place) => (place === null ? null : { fact, place }));
      }),
      (placed) => placed.filter((one): one is Placed => one !== null),
    );

  const instants = (work: RowHolder, placed: readonly Placed[], from: number): readonly InstantMark[] =>
    placed.flatMap(({ fact, place }) =>
      fact.after === undefined
        ? []
        : [lives.instant(place.checkout, work.holder, place.path, fact.after, Math.min(from, fact.at.getTime()), null)],
    );

  const rows = Effect.fnUntraced(function* (work: RowHolder, placed: readonly Placed[], state: RowState) {
    const runId = work.holder === OPERATOR_KEY ? null : yield* runningRunOf(units, store, work.projectId, work.holder);
    const headsAt = new Map<string, string | null>();
    const basis = yield* WriteBasis;
    for (const { place } of placed)
      if (!headsAt.has(place.checkout))
        headsAt.set(
          place.checkout,
          basis?.heads.has(place.checkout) ? (basis.heads.get(place.checkout) ?? null) : yield* heads.of(place.projectId, place),
        );
    const movedFrom = new Map(placed.map(({ fact, place }) => [fact.path, place.path] as const));
    return yield* units.write(changeLogWrites, () =>
      Effect.gen(function* () {
        const ids: { readonly id: string; readonly placed: Placed }[] = [];
        for (const one of placed) {
          const { fact, place } = one;
          yield* keepVersions(store.db, versionsOf(fact));
          const id = yield* insertRow(store.db, work, runId, headsAt.get(place.checkout) ?? null, state, {
            place,
            projectId: place.projectId,
            origin: fact.origin,
            mode: fact.mode ?? null,
            hunk: fact.hunk ?? null,
            beforeHash: fact.before ?? null,
            afterHash: fact.after ?? null,
            at: fact.at,
            movedFrom: fact.movedFrom === undefined ? null : (movedFrom.get(fact.movedFrom) ?? null),
            reverts: fact.reverts ?? null,
            key: fact.key ?? null,
          });
          if (id !== null) ids.push({ id, placed: one });
        }
        return ids;
      }),
    );
  });

  const intend = (work: RowHolder, placed: readonly Placed[]): Effect.Effect<Intended, StoreFailure> =>
    Effect.flatMap(Clock.currentTimeMillis, (from) =>
      Effect.map(rows(work, placed, 'writing'), (ids) => ({ holder: work, ids, marks: instants(work, placed, from) })),
    );

  const joins = Effect.fn('Intake.join')(function* (intended: Intended) {
    const written = intended.ids.map(({ id, placed }) => ({
      id,
      place: { checkout: placed.place.checkout, path: placed.place.path },
      fact: placed.fact,
    }));
    const windowed: Windowed = (checkout, since) => lives.openedSince(checkout, since);
    const found = yield* Effect.result(joinable(units, store, walks, bases, windowed, written));
    if (found._tag === 'Success') {
      unjoined = 0;
      yield* Effect.annotateCurrentSpan('intake.joins', found.success.length);
      return found.success;
    }
    unjoined += 1;
    yield* Effect.annotateCurrentSpan({ 'intake.unjoined': unjoined, 'intake.unjoined.reason': found.failure.message });
    if (unjoined === 1)
      yield* Effect.logWarning('operator writes stand as their own rows until the row they continue can be read again', {
        reason: found.failure.message,
      });
    return [];
  });

  const confirm = Effect.fnUntraced(function* (intended: Intended, landedAt: Date, joining: readonly Joining[]) {
    const modes = new Map<string, string | null>();
    for (const { id, placed } of intended.ids) {
      const { fact } = placed;
      modes.set(
        id,
        fact.origin === 'delete' || fact.mode !== undefined
          ? (fact.mode ?? null)
          : yield* modeAt(`${placed.place.root}/${placed.place.path}`),
      );
    }
    if (modes.size === 0) return;
    yield* units.write(changeLogWrites, () =>
      Effect.gen(function* () {
        const merged = new Set<string>();
        for (const one of joining) {
          if (lives.openedSince(one.place.checkout, one.since)) continue;
          if (yield* joined(store, one, modes.get(one.row) ?? null)) merged.add(one.row);
        }
        const byMode = new Map<string | null, string[]>();
        for (const [id, mode] of modes) if (!merged.has(id)) byMode.set(mode, [...(byMode.get(mode) ?? []), id]);
        yield* Effect.forEach(
          byMode,
          ([mode, ids]) =>
            store.db
              .update(workspaceChange)
              .set({ state: 'held', mode, at: landedAt })
              .where(and(inArray(workspaceChange.id, ids), eq(workspaceChange.state, 'writing'))),
          { discard: true },
        );
      }),
    );
  });

  const withdraw = (intended: Intended, path: string): Effect.Effect<void, IntakeRefused> => {
    for (const mark of intended.marks) mark.undo();
    if (intended.ids.length === 0) return Effect.void;
    return units
      .write(changeLogWrites, () =>
        Effect.flatMap(
          store.db
            .delete(workspaceChange)
            .where(
              and(
                inArray(
                  workspaceChange.id,
                  intended.ids.map((one) => one.id),
                ),
                eq(workspaceChange.state, 'writing'),
              ),
            )
            .returning({ before: workspaceChange.beforeHash, after: workspaceChange.afterHash }),
          (gone) =>
            releaseVersions(
              store.db,
              gone.flatMap((row) => [row.before, row.after]),
            ),
        ),
      )
      .pipe(Effect.mapError(refusal(path)));
  };

  const basis = Effect.fnUntraced(function* <A, E, R>(
    projectId: number,
    selected: readonly string[],
    work: Effect.Effect<A, E, R>,
  ): Effect.fn.Return<A, E | IntakeRefused, R> {
    const inherited = yield* WriteBasis;
    const places = new Map(inherited?.places);
    const pinned = new Map(inherited?.heads);
    const normalized = new Map(inherited?.normalized);
    const groups = new Map<string, NormalizationGroup>();
    const pin = Effect.fnUntraced(function* (checkout: CheckoutPlace) {
      if (!pinned.has(checkout.checkout)) pinned.set(checkout.checkout, yield* heads.of(checkout.projectId, checkout));
    });
    for (const path of selected) {
      const place = yield* placeOf(projectId, path, 'entry');
      const key = spellingKey(projectId, path, 'entry');
      places.set(key, place);
      for (const reached of yield* Effect.mapError(paths.rootsWithin(path), refusal(path))) yield* pin(reached);
      if (place === null) {
        const root = yield* Effect.mapError(paths.placeAcross(path), refusal(path));
        if (root?.path === '') yield* pin(root);
        normalized.set(key, false);
        continue;
      }
      if (!pinned.has(place.checkout)) pinned.set(place.checkout, yield* heads.of(place.projectId, place));
      if (normalized.has(key)) continue;
      const group = groups.get(place.checkout) ?? { root: place.root, paths: new Map<string, string>() };
      group.paths.set(path, place.path);
      groups.set(place.checkout, group);
    }
    for (const group of groups.values()) {
      const converted = yield* normalizedAt(git, group.root, [...group.paths.values()]).pipe(
        Effect.mapError(
          (failure) =>
            new IntakeRefused({ path: group.root, reason: `Cannot prepare line-ending normalization for deletion: ${troubleOf(failure)}` }),
        ),
      );
      for (const [path, name] of group.paths) normalized.set(spellingKey(projectId, path, 'entry'), converted.has(name));
    }
    return yield* Effect.provideService(work, WriteBasis, { places, heads: pinned, normalized });
  });

  return {
    basis,
    normalized: (projectId: number, path: string) =>
      Effect.map(WriteBasis, (basis) => basis?.normalized.get(spellingKey(projectId, path, 'entry'))),
    placeOf,
    announce,
    turn: <A, E, R>(
      projectId: number,
      paths: readonly string[],
      work: Effect.Effect<A, E, R>,
      target: ChangeTarget = 'resource',
    ): Effect.Effect<A, E | IntakeRefused, R> =>
      Effect.flatMap(
        Effect.forEach(paths, (path) => Effect.map(placeOf(projectId, path, target), (place) => ({ path, place }))),
        (located) =>
          Effect.suspend(() => {
            const spellings = located.flatMap(({ path, place }) =>
              place === null ? [] : [{ spelled: spellingKey(projectId, path, target), place }],
            );
            if (spellings.length === 0) return work;
            const taken = [...new Set(spellings.map(({ place }) => placeKey(place)))].sort().map((key) => {
              const turn = turns.get(key) ?? { permits: Semaphore.makeUnsafe(1), users: 0 };
              turns.set(key, turn);
              turn.users += 1;
              return { key, turn };
            });
            const named = spellings.map(({ spelled, place }) => {
              const spelling = placing.get(spelled) ?? { place, users: 0 };
              placing.set(spelled, spelling);
              spelling.users += 1;
              return { spelled, spelling };
            });
            return taken
              .reduceRight<Effect.Effect<A, E, R>>((inner, { turn }) => turn.permits.withPermit(inner), work)
              .pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    for (const { key, turn } of taken) {
                      turn.users -= 1;
                      if (turn.users === 0) turns.delete(key);
                    }
                    for (const { spelled, spelling } of named) {
                      spelling.users -= 1;
                      if (spelling.users === 0) placing.delete(spelled);
                    }
                  }),
                ),
              );
          }),
      ),
    land: <E, R>(
      work: IntakeWork,
      facts: readonly IntakeFact[],
      write: Effect.Effect<boolean, E, R>,
    ): Effect.Effect<Landed, E | IntakeRefused, R> => {
      const holder = rowHolder(work);
      return Effect.flatMap(placedOf(work.projectId, facts), (placed) => {
        if (placed.length === 0)
          return Effect.map(write, (written): Landed => (written ? { _tag: 'written', kept: false } : { _tag: 'moved' }));
        const named = placed[0]?.fact.path ?? '';
        return Effect.uninterruptible(
          Effect.gen(function* () {
            const intended = yield* intend(holder, placed).pipe(Effect.withSpan('Intake.intent'), Effect.mapError(refusal(named)));
            const written = yield* Effect.catch(write.pipe(Effect.withSpan('Intake.write')), (failure) =>
              Effect.andThen(withdraw(intended, named), Effect.fail(failure)),
            );
            if (!written) {
              yield* withdraw(intended, named);
              return { _tag: 'moved' } satisfies Landed;
            }
            for (const mark of intended.marks) mark.landed();
            const joining = work.holder.kind === 'operator' ? yield* joins(intended) : [];
            const confirmed = yield* Effect.result(
              confirm(intended, new Date(yield* Clock.currentTimeMillis), joining).pipe(Effect.withSpan('Intake.confirm')),
            );
            if (confirmed._tag === 'Failure') return { _tag: 'unconfirmed', reason: confirmed.failure.message } satisfies Landed;
            yield* announcePlaced(holder.holder, placed);
            return { _tag: 'written', kept: true } satisfies Landed;
          }),
        );
      });
    },
    report: Effect.fnUntraced(function* (work: IntakeWork, facts: readonly IntakeFact[]) {
      const holder = rowHolder(work);
      const placed = yield* placedOf(work.projectId, facts);
      if (placed.length === 0) return [];
      const named = placed[0]?.fact.path ?? '';
      yield* rows(holder, placed, 'held').pipe(Effect.mapError(refusal(named)));
      for (const mark of instants(holder, placed, yield* Clock.currentTimeMillis)) mark.landed();
      yield* announcePlaced(holder.holder, placed);
      return placed.map(({ place }): PlacedPath => ({ checkout: place.checkout, path: place.path }));
    }),
  };
});
