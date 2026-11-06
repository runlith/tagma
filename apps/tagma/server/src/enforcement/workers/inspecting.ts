import { bunSpawner } from '@runlith/executions/bunSpawner';
import * as BunChildProcessSpawner from '@effect/platform-bun/BunChildProcessSpawner';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import * as BunPath from '@effect/platform-bun/BunPath';
import { type Assembled, type PackId, relevant, sliceable } from '@tagma/inspection/builtins';
import { ready, usedPacks } from '@tagma/inspection/node/builtins';
import { admit, type Budget, budgetOf, unbounded } from '@tagma/inspection/node/budget';
import { facetFor, inspect, lists, prefetches, reachKey, remapped, selects } from '@tagma/inspection/node/implementations';
import { type InspectionMemo, type MemoValue, ReachHeadMoved, memoWrites, type Validity } from '@tagma/inspection/node/memo';
import { judge, judgeReadings } from '@tagma/inspection/node/judge';
import { comparesOf, measuredOf, planOf, type Sliced, snapshotOf } from '@tagma/inspection/node/slices';
import type { Verdict } from '@tagma/inspection/verdict';
import type { Footprint, Reading } from '@tagma/inspection/node/reading';
import type { ProgramFacts } from '@tagma/inspection/program';
import { ADAPTERS } from '@runlith/code-facts/adapters';
import { blobTree, facetHeld, memoHolds, parseAhead } from '@runlith/code-facts/blobs';
import { installedStamp } from '@runlith/code-facts/js/config';
import type { Installed, Tree, TreeChange } from '@runlith/code-facts/tree';
import { createHash } from 'node:crypto';
import { gitLayer, Git } from '@runlith/git/Git';
import { diffTreeAt, pointedTreeAt, type TreeListing } from '@runlith/git/trees';
import {
  changesBetween,
  frontiersOf,
  generatedAt,
  jobOf,
  keepNearSnapshot,
  listingAt,
  nearSnapshot,
  rememberSnapshot,
  snapshotFor,
  treeOf,
  validityOf,
} from './treeMemo.js';
import { Effect, Exit, FileSystem, Layer, ManagedRuntime, Result } from 'effect';
import { actingGit, ownGitLayer } from '../../platform/git/ownGit.js';
import type {
  Compared,
  HistoryPage,
  InspectionAnswer,
  Installs,
  JudgeRequest,
  PackUseAsk,
  PlanAsk,
  Planned,
  Posted,
  ReachRequest,
  SliceAsk,
  StateAsk,
} from './asks.js';
import { cacheAt, type InspectionCache, rested } from './caches.js';
import { checkoutAt, checkoutFile, checkoutText, installedIn } from './checkout.js';
import { ensureCalibration, subjectAt } from './calibration.js';
import { factsAt } from './facts.js';
import { facets, parses, trimParses } from './parses.js';
import { carried, keepReading, knownReading } from './readings.js';
import { fetchedBlobs, GrowingPaths, matchInto, mentioned, pointInto, type Side, sideTree, texts, type Working } from './sides.js';
import { gitUnread, Unread, unreadFrom } from './unread.js';
import { inspectionFileLocal } from '../contract/wire/enforcement.js';
import { gave, phaseTracer, reporting, stateOf, taken, watching } from './waits.js';
import { historyAt } from './past.js';

const spawning = watching(
  process.platform === 'win32'
    ? BunChildProcessSpawner.layer.pipe(Layer.provide(Layer.merge(BunFileSystem.layer, BunPath.layer)))
    : bunSpawner({ detached: true }),
);
const runtime = ManagedRuntime.make(Layer.merge(ownGitLayer(gitLayer.pipe(Layer.provide(spawning))), BunFileSystem.layer));

const reachKeyOf = (inspection: Assembled, slot: string): string | undefined => {
  try {
    return reachKey(inspection, slot);
  } catch {
    return undefined;
  }
};

const treeIdOf = (git: Git['Service'], root: string, commit: string) => treeOf(git, root, commit).pipe(Effect.mapError(gitUnread));
const treeIdsOf = (git: Git['Service'], root: string, base: string, built: string) =>
  Effect.map(Effect.all([treeIdOf(git, root, base), treeIdOf(git, root, built)]), ([baseTree, builtTree]) => ({ baseTree, builtTree }));
const diffEntriesOf = (git: Git['Service'], root: string, from: string, to: string) =>
  diffTreeAt(git, root, from, to).pipe(Effect.mapError(gitUnread));
const listing = (git: Git['Service'], root: string, commit: string, parts: readonly string[]) =>
  listingAt(git, root, commit, parts).pipe(Effect.mapError(gitUnread));
type Worked =
  | { readonly verdict: Verdict; readonly footprint?: Footprint }
  | Planned
  | { readonly sliced: Sliced }
  | { readonly packs: readonly PackId[] }
  | { readonly facts: ProgramFacts; readonly hits: number }
  | { readonly history: HistoryPage }
  | { readonly rested: true };

const settled = Effect.fn('inspecting.settled')(function* (
  git: Git['Service'],
  root: string,
  inspection: Assembled,
  sides: readonly Side[],
  work: (trees: readonly Tree[], memo: InspectionMemo, trusted: InspectionMemo | undefined, budget: Budget) => Worked,
  cache: InspectionCache | undefined,
  trusted?: Map<string, MemoValue>,
  validity?: Validity,
  checkoutRoot = root,
  compared?: Compared,
  installed: Installs = [],
  budget?: Budget,
) {
  return yield* Effect.gen(function* () {
    const calibration = yield* ensureCalibration(git, root, inspection, sides, cache);
    const imports = cache?.parses ?? parses;
    const store: InspectionMemo = cache?.memo ?? new Map();
    const prefetch = prefetches(inspection.builtin);
    if (prefetch) yield* Effect.try({ try: () => admit(inspection.builtin, calibration, subjectAt(sides)), catch: unreadFrom });
    const held = new Map<string, string>();
    const unread = new Map<string, string>();
    const facet = facetFor(inspection.builtin);
    const declarations = facet !== undefined;
    const known = (object: string, path: string) =>
      facet !== undefined ? facetHeld(facets, ADAPTERS, facet, object, path) : memoHolds(imports, ADAPTERS, object, path);
    const words = sides.map(() => new Map<string, ReadonlySet<string>>());
    const checkout = new Map<string, Installed | null>([
      ...installed,
      ...(compared ?? []).map(([path, text]) => [path, text === null ? null : { text, at: path }] as const),
    ]);
    const placed = yield* checkoutAt(checkoutRoot);
    const working: Working = {
      files: checkout,
      asked: new Set(),
      installed: new Set(),
      compared: compared === undefined ? undefined : new Set(compared.map(([path]) => path)),
      depth: placed.depth,
    };
    const fetchedBudget = budget ?? budgetOf(inspection.builtin, calibration);
    let wanted = sides.map((side) => ({
      ...side,
      paths: prefetch ? side.paths.filter((path) => !known(side.listed.objects.get(path) ?? '', path)) : [],
    }));
    let headRetries = 0;
    for (;;) {
      try {
        for (const side of wanted)
          for (const path of side.paths) {
            const object = side.listed.objects.get(path);
            if (object !== undefined) fetchedBudget.blob?.(object, side.listed.sizes.get(path) ?? 0);
          }
      } catch (error) {
        return yield* unreadFrom(error);
      }
      const fetched = yield* texts(git, root, wanted);
      for (const [object, text] of fetched.held) held.set(object, text);
      for (const [object, reason] of fetched.unread) unread.set(object, reason);
      if (!declarations && prefetch) {
        const blobs = fetchedBlobs(wanted, fetched.held);
        yield* Effect.promise(() => parseAhead(imports, ADAPTERS, blobs)).pipe(
          Effect.withSpan('inspecting.parse', { attributes: { files: blobs.length } }),
        );
      }
      const missing = sides.map(() => new Set<string>());
      const asked = sides.map(() => new Map<string, readonly string[]>());
      const touched = new Set(sides.flatMap((side) => side.paths));
      working.installed.clear();
      const trees = sides.map((side, at) =>
        sideTree(
          blobTree(side.listed.objects, held, imports, ADAPTERS, missing[at], facets),
          touched,
          side,
          words[at] as Map<string, ReadonlySet<string>>,
          asked[at] as Map<string, readonly string[]>,
          unread,
          { working, judged: at === sides.length - 1 },
        ),
      );
      const table = cache?.reach;
      const memo = memoWrites(store, table, validity);
      const kept = trusted === undefined ? undefined : memoWrites(trusted);
      const { worked, thrown } = yield* Effect.sync((): { readonly worked?: Worked; readonly thrown?: unknown } => {
        try {
          const run = () => work(trees, memo, kept, budgetOf(inspection.builtin, calibration));
          return { worked: table?.round === undefined ? run() : table.round(run) };
        } catch (error) {
          return { thrown: error };
        }
      }).pipe(Effect.withSpan('inspecting.compute', { attributes: { files: touched.size } }));
      if (thrown instanceof ReachHeadMoved) {
        if (headRetries >= 3) return yield* unreadFrom(thrown);
        headRetries += 1;
        const key = reachKeyOf(inspection, root);
        const current = key === undefined ? undefined : table?.open<unknown, unknown>(key).head;
        if (key === undefined || current === undefined) return yield* unreadFrom(thrown);
        const baseTree = sides[0]?.tree ?? '';
        const builtTree = sides[1]?.tree ?? baseTree;
        const baseEntries = sides[0]?.change?.baseEntries ?? [];
        const fresh = current.tree === baseTree ? undefined : yield* diffEntriesOf(git, root, current.tree, baseTree);
        const next: TreeChange =
          fresh === undefined
            ? { slot: root, baseTree, builtTree, baseEntries, headTree: current.tree }
            : { slot: root, baseTree, builtTree, baseEntries, headTree: current.tree, headEntries: fresh };
        for (const side of sides) (side as { change?: TreeChange }).change = next;
        const freshPaths = [...new Set((fresh ?? []).map((entry) => entry.path))].filter(
          (path) => !(sides[0]?.lookedUp?.has(path) ?? true),
        );
        if (freshPaths.length > 0 && sides[0] !== undefined) yield* pointInto(git, root, baseTree, sides[0], freshPaths);
        wanted = sides.map((side) => ({ ...side, paths: [] as string[] }));
        continue;
      }
      const unknowns = sides.map((side) => (side.unknown === undefined ? [] : [...side.unknown]));
      const unknownTotal = unknowns.reduce((sum, paths) => sum + paths.length, 0);
      const unmatched = sides.map((side) => (side.unmatched === undefined ? [] : [...side.unmatched]));
      const unmatchedTotal = unmatched.reduce((sum, globs) => sum + globs.length, 0);
      if (
        missing.every((paths) => paths.size === 0) &&
        asked.every((one) => one.size === 0) &&
        unknownTotal === 0 &&
        unmatchedTotal === 0 &&
        working.asked.size === 0
      ) {
        trimParses(imports);
        if (worked === undefined) return yield* unreadFrom(thrown);
        yield* Effect.sync(() => {
          if (!('sliced' in worked) || worked.sliced.needs.length === 0) {
            memo.commit();
            kept?.commit();
          }
          cache?.flush();
        }).pipe(Effect.withSpan('inspecting.commit'));
        const used: Installs = [...working.installed].map((path) => [path, checkout.get(path) ?? null]);
        return { worked, read: [...touched], installed: used };
      }
      for (const [at, side] of sides.entries()) {
        const paths = unknowns[at] ?? [];
        side.unknown?.clear();
        if (paths.length > 0) yield* pointInto(git, root, side.tree, side, paths);
        side.unmatched?.clear();
        for (const [key, globs] of unmatched[at] ?? []) if (side.matched?.has(key) !== true) yield* matchInto(git, root, side, key, globs);
        for (const path of missing[at] ?? []) {
          const reason = unread.get(side.listed.objects.get(path) ?? '');
          if (reason !== undefined) return yield* new Unread({ cause: 'source', reason: `${path}: ${reason}` });
        }
        for (const [key, terms] of asked[at] ?? []) {
          const found = yield* mentioned(git, root, side, terms);
          words[at]?.set(key, found);
        }
      }
      for (const path of working.asked) checkout.set(path, yield* checkoutFile(placed.real, path));
      working.asked.clear();
      wanted = sides.map((side, at) => ({ ...side, paths: [...(missing[at] ?? [])] }));
    }
  }).pipe(
    Effect.onExit((exit) =>
      Effect.sync(() => {
        if (Exit.isFailure(exit)) cache?.flush();
      }),
    ),
  );
});

const within = (places: readonly string[]) => (path: string) =>
  places.some((place) => place === '' || path === place || path.startsWith(`${place}/`));

const reach = Effect.fn('inspecting.reach')(function* (git: Git['Service'], ask: ReachRequest, cache: InspectionCache | undefined) {
  if (ask.paths !== undefined && !inspectionFileLocal(ask.inspection))
    return yield* new Unread({ cause: 'source', reason: `${ask.inspection.builtin} does not declare file-local measurements` });
  const parts = lists(ask.inspection);
  const covered = within(ask.places);
  const picked = ask.paths?.filter((path) => covered(path) && selects(ask.inspection, path));
  const tree = yield* treeIdOf(git, ask.root, ask.commit);
  const listed = yield* picked === undefined
    ? listing(git, ask.root, ask.commit, parts)
    : pointedTreeAt(git, ask.root, tree, picked).pipe(Effect.mapError(gitUnread));
  const key = ask.previous === undefined ? undefined : reachKeyOf(ask.inspection, ask.root);
  const head = key === undefined ? undefined : cache?.reach.open<unknown, unknown>(key).head;
  const change: TreeChange | undefined =
    head === undefined || head.tree === tree
      ? undefined
      : {
          slot: ask.root,
          baseTree: tree,
          builtTree: tree,
          baseEntries: [],
          headTree: head.tree,
          headEntries: yield* diffEntriesOf(git, ask.root, head.tree, tree),
        };
  const reached = [...listed.objects.keys()].filter(covered);
  const generated = yield* generatedAt(git, ask.root, tree, reached).pipe(
    Effect.mapError((failure) => new Unread({ cause: 'git', reason: `which files are generated could not be read: ${failure.message}` })),
  );
  const judged = (path: string) => covered(path) && !generated(path);
  const paths = reached.filter((path) => !generated(path) && selects(ask.inspection, path));
  let selected: readonly string[] = paths;
  const result = yield* settled(
    git,
    ask.root,
    ask.inspection,
    [{ commit: ask.commit, tree, slot: ask.root, listed, parts, paths: ask.previous === undefined ? paths : [], change }],
    ([tree], memo, _trusted, budget) => {
      const mapped =
        ask.previous === undefined
          ? undefined
          : remapped(ask.inspection, ask.previous.inspection, tree as Tree, ask.previous.fingerprints, budget, ADAPTERS, memo);
      selected = (mapped?.paths ?? paths).filter(judged);
      return {
        verdict: inspect(ask.inspection, tree as Tree, selected, budget, ADAPTERS, memo, ask.paths === undefined ? 'reach' : 'change'),
        footprint: mapped?.footprint,
      };
    },
    cache,
  );
  return { ...result, read: [...new Set([...result.read, ...selected])] };
});

const slicedOnly = (inspection: Assembled) =>
  sliceable(inspection)
    ? Effect.succeed(inspection)
    : Effect.fail(new Unread({ cause: 'source', reason: `${inspection.builtin} is not judged in slices` }));

const comparedAt = Effect.fn('inspecting.compared')(function* (root: string, inspection: Assembled) {
  const held: [string, string | null][] = [];
  for (const path of comparesOf(inspection)) held.push([path, yield* checkoutText(root, path)]);
  return held;
});

type HeldReading = { readonly reading: Reading; readonly installed: Installs } | { readonly same: true };

const readingHeld = Effect.fn('inspecting.readingHeld')(function* (
  git: Git['Service'],
  ask: PlanAsk,
  inspection: Assembled,
  tree: string,
  compared: Compared,
  cache: InspectionCache | undefined,
): Effect.fn.Return<HeldReading | undefined, Unread, FileSystem.FileSystem> {
  const known = knownReading(cache?.memo, inspection, ask.places, compared, tree);
  if (known !== undefined) {
    const installed = yield* installedIn(
      ask.checkout ?? ask.root,
      ask.installed ?? [],
      known.installed.map(([path]) => path),
    );
    if (installed.every(([, file], at) => installedStamp(file ?? undefined) === known.installed[at]![1]))
      return { reading: known.reading, installed };
  }
  if (ask.from === undefined || compared.length > 0) return undefined;
  const from = yield* treeIdOf(git, ask.root, ask.from.commit);
  if (from === tree) return { same: true };
  const changes = yield* changesBetween(git, ask.root, from, tree).pipe(Effect.mapError(gitUnread));
  const ends = { from: ask.from.commit, to: ask.commit };
  return (yield* carried(git, ask.root, inspection, ends, changes, cache?.parses ?? parses)) ? { same: true } : undefined;
});

const plan = Effect.fn('inspecting.plan')(function* (git: Git['Service'], ask: PlanAsk, cache: InspectionCache | undefined) {
  const inspection = yield* slicedOnly(ask.inspection);
  const tree = yield* treeIdOf(git, ask.root, ask.commit);
  const job = jobOf(ask.job);
  const compared = ask.compared ?? (yield* comparedAt(ask.checkout ?? ask.root, inspection));
  const held = ask.measures === true ? undefined : yield* readingHeld(git, ask, inspection, tree, compared, cache);
  if (held !== undefined && 'reading' in held)
    return { worked: { reading: held.reading, compared } satisfies Worked, read: [], installed: held.installed };
  if (held !== undefined) return { worked: { same: true, compared } satisfies Worked, read: [], installed: [] };
  const parts = lists(inspection);
  const listed = yield* listing(git, ask.root, ask.commit, parts);
  const kind = createHash('sha256').update(JSON.stringify(inspection)).digest('hex');
  const near = ask.measures === true ? undefined : nearSnapshot(ask.root, kind);
  const between =
    near === undefined || near.tree === tree ? undefined : yield* Effect.result(changesBetween(git, ask.root, near.tree, tree));
  const changes = between === undefined || Result.isFailure(between) ? undefined : between.success;
  const standing = near?.tree === tree ? near.snapshot : undefined;
  let prepared: unknown;
  const result = yield* settled(
    git,
    ask.root,
    inspection,
    [{ commit: ask.commit, tree, slot: ask.root, listed, parts, paths: [] }],
    ([tree]) => {
      try {
        prepared =
          standing ??
          snapshotOf(
            inspection,
            tree as Tree,
            near === undefined || changes === undefined ? undefined : { snapshot: near.snapshot, changes },
          );
      } catch {
        prepared = undefined;
      }
      return { plan: planOf(inspection, tree as Tree, ask.places, prepared), compared };
    },
    cache,
    undefined,
    undefined,
    ask.checkout ?? ask.root,
    compared,
    ask.installed,
    unbounded(),
  );
  if (prepared !== undefined) {
    rememberSnapshot(job, ask.commit, prepared);
    keepNearSnapshot(ask.root, kind, tree, prepared);
  }
  return result;
});

const slice = Effect.fn('inspecting.slice')(function* (git: Git['Service'], ask: SliceAsk, cache: InspectionCache | undefined) {
  const inspection = yield* slicedOnly(ask.inspection);
  const job = jobOf(ask.job);
  const parts = lists(inspection);
  const listed = yield* listing(git, ask.root, ask.commit, parts);
  const tree = yield* treeIdOf(git, ask.root, ask.commit);
  return yield* settled(
    git,
    ask.root,
    inspection,
    [{ commit: ask.commit, tree, slot: ask.root, listed, parts, paths: [] }],
    ([tree], memo, trusted) => ({
      sliced: measuredOf(inspection, tree as Tree, ask.scope, memo, trusted, snapshotFor(job, ask.commit), ask.places),
    }),
    cache,
    frontiersOf(job, ask.commit),
    ask.measures === true ? undefined : validityOf(ask.root, tree),
    ask.checkout ?? ask.root,
    ask.compared,
    ask.installed,
    unbounded(),
  );
});

const changed = (inspection: Assembled, listed: TreeListing, paths: readonly string[]) =>
  paths.filter((path) => listed.objects.has(path) && selects(inspection, path));

const matters = (inspection: Assembled, path: string): boolean => selects(inspection, path) || relevant(inspection, path);

const judged = (git: Git['Service'], ask: JudgeRequest, sides: readonly Side[], cache: InspectionCache | undefined) =>
  settled(
    git,
    ask.root,
    ask.inspection,
    sides,
    ([base, built], memo, _trusted, budget) => {
      const trees = { base: base as Tree, built: built as Tree, paths: ask.paths };
      return {
        verdict:
          ask.readings === undefined
            ? judge(ask.inspection, trees, ask.debt, budget, ADAPTERS, memo)
            : judgeReadings(ask.inspection, trees, ask.debt, ask.readings.base, ask.readings.built, budget),
      };
    },
    cache,
    undefined,
    undefined,
    ask.checkout,
  );

const change = Effect.fn('inspecting.change')(function* (git: Git['Service'], ask: JudgeRequest, cache: InspectionCache | undefined) {
  if (!ask.paths.some((path) => matters(ask.inspection, path)))
    return { worked: { verdict: { violations: [], unjudged: [] } } as Worked, read: [] };
  if (ask.readings !== undefined && cache !== undefined) {
    const { baseTree, builtTree } = yield* treeIdsOf(git, ask.root, ask.base, ask.built);
    const { base, built, compared } = ask.readings;
    keepReading(cache.memo, ask.inspection, ask.places, [], baseTree, base, ask.readings.installed.base);
    keepReading(cache.memo, ask.inspection, ask.places, compared, builtTree, built, ask.readings.installed.built);
  }
  const parts = lists(ask.inspection);
  if (prefetches(ask.inspection.builtin)) {
    const base = yield* listing(git, ask.root, ask.base, parts);
    const baseTree = yield* treeIdOf(git, ask.root, ask.base);
    const built = ask.base === ask.built ? base : yield* listing(git, ask.root, ask.built, parts);
    const builtTree = ask.base === ask.built ? baseTree : yield* treeIdOf(git, ask.root, ask.built);
    const key = reachKeyOf(ask.inspection, ask.root);
    const head = key === undefined ? undefined : cache?.reach.open<unknown, unknown>(key).head;
    const changeMeta: TreeChange | undefined =
      key === undefined
        ? undefined
        : {
            slot: ask.root,
            baseTree,
            builtTree,
            baseEntries: yield* diffEntriesOf(git, ask.root, baseTree, builtTree),
            headTree: head?.tree ?? null,
            headEntries:
              head === undefined || head.tree === baseTree ? undefined : yield* diffEntriesOf(git, ask.root, head.tree, baseTree),
          };
    const sides: readonly Side[] = [
      {
        commit: ask.base,
        tree: baseTree,
        slot: ask.root,
        listed: base,
        parts,
        paths: changed(ask.inspection, base, ask.paths),
        change: changeMeta,
      },
      {
        commit: ask.built,
        tree: builtTree,
        slot: ask.root,
        listed: built,
        parts,
        paths: changed(ask.inspection, built, ask.paths),
        change: changeMeta,
      },
    ];
    return yield* judged(git, ask, sides, cache);
  }
  const { baseTree, builtTree } = yield* treeIdsOf(git, ask.root, ask.base, ask.built);
  const baseEntries = yield* diffEntriesOf(git, ask.root, baseTree, builtTree);
  const key = reachKeyOf(ask.inspection, ask.root);
  const head = key === undefined ? undefined : cache?.reach.open<unknown, unknown>(key).head;
  const headEntries = head === undefined || head.tree === baseTree ? undefined : yield* diffEntriesOf(git, ask.root, head.tree, baseTree);
  const changeMeta: TreeChange =
    headEntries === undefined
      ? { slot: ask.root, baseTree, builtTree, baseEntries, headTree: head?.tree ?? null }
      : { slot: ask.root, baseTree, builtTree, baseEntries, headTree: head?.tree ?? null, headEntries };
  if (ask.readings === undefined && (head === undefined || (head.tree !== baseTree && headEntries === undefined))) {
    const base = yield* listing(git, ask.root, ask.base, parts);
    const built = ask.base === ask.built ? base : yield* listing(git, ask.root, ask.built, parts);
    const sides: readonly Side[] = [
      {
        commit: ask.base,
        tree: baseTree,
        slot: ask.root,
        listed: base,
        parts,
        paths: changed(ask.inspection, base, ask.paths),
        change: changeMeta,
      },
      {
        commit: ask.built,
        tree: builtTree,
        slot: ask.root,
        listed: built,
        parts,
        paths: changed(ask.inspection, built, ask.paths),
        change: changeMeta,
      },
    ];
    return yield* judged(git, ask, sides, cache);
  }
  const seed = [...new Set([...ask.paths, ...baseEntries.map((entry) => entry.path)])];
  const baseObjects = new Map<string, string>();
  const baseSizes = new Map<string, number>();
  const baseOrdered = new GrowingPaths();
  const shared = baseTree === builtTree;
  const builtObjects = shared ? baseObjects : new Map<string, string>();
  const builtSizes = shared ? baseSizes : new Map<string, number>();
  const builtOrdered = shared ? baseOrdered : new GrowingPaths();
  const baseMatched = new Map<string, readonly string[]>();
  const baseSide: Side = {
    commit: ask.base,
    tree: baseTree,
    slot: ask.root,
    listed: { objects: baseObjects, sizes: baseSizes, ordered: baseOrdered },
    parts,
    paths: [],
    change: changeMeta,
    lookedUp: new Set(),
    unknown: new Set(),
    matched: baseMatched,
    unmatched: new Map(),
  };
  const builtSide: Side = shared
    ? {
        commit: ask.built,
        tree: builtTree,
        slot: ask.root,
        listed: { objects: baseObjects, sizes: baseSizes, ordered: baseOrdered },
        parts,
        paths: [],
        change: changeMeta,
        lookedUp: new Set(),
        unknown: new Set(),
        matched: baseMatched,
        unmatched: new Map(),
      }
    : {
        commit: ask.built,
        tree: builtTree,
        slot: ask.root,
        listed: { objects: builtObjects, sizes: builtSizes, ordered: builtOrdered },
        parts,
        paths: [],
        change: changeMeta,
        lookedUp: new Set(),
        unknown: new Set(),
        matched: new Map(),
        unmatched: new Map(),
      };
  yield* pointInto(git, ask.root, baseTree, baseSide, seed);
  if (!shared) yield* pointInto(git, ask.root, builtTree, builtSide, seed);
  const sides: readonly Side[] = [
    { ...baseSide, paths: changed(ask.inspection, baseSide.listed, ask.paths) },
    { ...builtSide, paths: changed(ask.inspection, builtSide.listed, ask.paths) },
  ];
  return yield* judged(git, ask, sides, cache);
});

const packUse = Effect.fn('inspecting.packUse')(function* (git: Git['Service'], ask: PackUseAsk) {
  const listed = yield* listing(git, ask.root, ask.commit, ['']);
  const side: Side = {
    commit: ask.commit,
    tree: '',
    slot: ask.root,
    listed,
    parts: [''],
    paths: [...listed.ordered].filter((path) => path === 'package.json' || path.endsWith('/package.json')),
  };
  const fetched = yield* texts(git, ask.root, [side]);
  const tree = sideTree(
    blobTree(listed.objects, fetched.held, parses, ADAPTERS, undefined, facets),
    new Set(),
    side,
    new Map(),
    new Map(),
    fetched.unread,
  );
  return yield* Effect.try({ try: () => ({ worked: { packs: usedPacks(tree) }, read: side.paths }), catch: unreadFrom });
});

export const serve = (port: Worker, serves: 'reach' | 'judge'): void => {
  reporting(port);
  port.addEventListener('message', (event: MessageEvent<Posted | StateAsk>) => {
    const posted = event.data;
    if (posted.kind === 'state') {
      void stateOf(posted.about, posted.look).then((state) => port.postMessage(state));
      return;
    }
    taken(posted.id);
    answer(posted, serves).then(
      (reply) => port.postMessage(gave(reply)),
      (error: unknown) => port.postMessage(gave({ id: posted.id, answered: false, cause: 'source', reason: String(error) })),
    );
  });
};

export const answer = (posted: Posted, serves: 'reach' | 'judge'): Promise<InspectionAnswer> => {
  const started = performance.now();
  const work = Effect.gen(function* () {
    const git = actingGit(yield* Git, 'inspection');
    if (posted.kind === 'rest') return yield* rested(git, posted.cacheRoot);
    if (posted.kind === 'history' && serves === 'reach') return yield* historyAt(git, posted);
    if (
      posted.kind !== serves &&
      posted.kind !== 'plan' &&
      posted.kind !== 'slice' &&
      !(posted.kind === 'facts' && serves === 'judge') &&
      !(posted.kind === 'packs' && serves === 'reach')
    ) {
      return yield* new Unread({ cause: 'source', reason: `this worker serves ${serves} asks, and was sent a ${posted.kind} ask` });
    }
    const cache = 'root' in posted ? yield* cacheAt(git, posted.root, posted.cacheRoot) : undefined;
    if (posted.kind === 'facts') {
      const worked = yield* factsAt(git, posted, parses, facets);
      trimParses(parses);
      return { worked: worked satisfies Worked, read: worked.facts.sides.flatMap((side) => side.files.map((file) => file.path)) };
    }
    if (posted.kind === 'packs') return yield* packUse(git, posted);
    yield* Effect.tryPromise({
      try: () => ready(posted.inspection.builtin),
      catch: (error) => new Unread({ cause: 'source', reason: `the pack of ${posted.inspection.builtin} did not load: ${String(error)}` }),
    }).pipe(Effect.withSpan('inspecting.pack'));
    switch (posted.kind) {
      case 'reach':
        return yield* reach(git, posted, cache);
      case 'judge':
        return yield* change(git, posted, cache);
      case 'plan':
        return yield* plan(git, posted, cache);
      case 'slice':
        return yield* slice(git, posted, cache);
    }
  });
  return runtime.runPromise(
    work.pipe(
      Effect.map((done): InspectionAnswer => ({
        id: posted.id,
        answered: true,
        ...done.worked,
        read: done.read,
        installed: 'installed' in done ? done.installed : [],
        ms: Math.round(performance.now() - started),
      })),
      Effect.catchTag('Unread', (unread) =>
        Effect.succeed<InspectionAnswer>({
          id: posted.id,
          answered: false,
          cause: unread.cause,
          reason: unread.reason,
          split: unread.split,
        }),
      ),
      Effect.withTracer(phaseTracer),
    ),
  );
};
