import { Deferred, Duration, Effect, type FileSystem } from 'effect';
import type { Permits } from '@runlith/held/Permits';
import { commitOf, literal, publishRemoteAt, GitUnreadable, type GitAnswerInvalid, type GitRefused } from '@runlith/git/repository';
import { compareAt, numstatAt, type ComparedRow, type Comparison, type LineStat, type PathStat } from '@runlith/git/history';
import { mergeScoped, pathspecFits, refreshBranch, sequencerAt, statusAt, type Status, type StatusRow } from '@runlith/git/status';
import type { Git } from '@runlith/git/Git';
import type { SequencerKind } from '@runlith/git/vocabulary';
import { type CheckoutArea, type CheckoutEntry, type CheckoutState, type ComparedPath } from '../contract/wire/checkout.js';
import type { RootId } from '../contract/wire/ids.js';
import { SLOW_STATUS_MS } from '../contract/wire/settings.js';
import type { Following } from '../contract/service/watch.js';
import { READING_CAPTURE, untrackedWeight } from './weight.js';

const OPEN_FILES = 6;

const READING_DEADLINE = '30 seconds';

export type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;

export type Compared = {
  readonly base: string;
  readonly tip: string;
  readonly head: string;
  readonly result: Comparison;
};

export type Areas = {
  readonly staged: readonly ComparedPath[];
  readonly unstaged: readonly ComparedPath[];
  readonly untracked: readonly ComparedPath[];
  readonly unmerged: readonly ComparedPath[];
};

type Metadata = {
  readonly refs: boolean;
  readonly operation: boolean;
};

export type TreeReading = {
  readonly status: Status;
  readonly sequencer: SequencerKind;
  readonly statusMs: number | null;
  readonly publishTo: string | null;
  readonly areas: Areas;
};

export type SharedTree = {
  epoch: number;
  taken: { epoch: number | null; readonly done: Deferred.Deferred<TreeReading, GitFailure> } | null;
  readonly why: Set<string>;
  paths: Set<string> | null;
};

export type ReadingState = {
  readonly rootId: RootId;
  readonly dir: string;
  readonly key: string;
  readonly base: string | null;
  readonly watch: Following | null;
};

export type SharedReading = {
  readonly git: Git['Service'];
  readonly files: FileSystem.FileSystem;
  readonly readings: Permits;
  readonly trees: Map<RootId, SharedTree>;
  readonly compared: Map<string, Compared>;
  readonly readerCountOf: (rootId: RootId) => number;
  readonly treeChanged: (rootId: RootId) => Effect.Effect<void>;
};

const areaOf = (entries: readonly CheckoutEntry[]): CheckoutArea => {
  let added = 0;
  let removed = 0;
  for (const entry of entries) {
    if (typeof entry.lines === 'string') continue;
    added += entry.lines.added;
    removed += entry.lines.removed;
  }
  return { entries, added, removed };
};

const weighed = (stats: readonly PathStat[]): ReadonlyMap<string, LineStat> => new Map(stats.map((stat) => [stat.path, stat.lines]));

const UNWEIGHED: ReadonlyMap<string, LineStat> = new Map();

const tracked = (entries: readonly StatusRow[], stats: ReadonlyMap<string, LineStat>): ComparedPath[] =>
  entries.map((entry) => ({
    path: entry.path,
    status: entry.status,
    oldPath: entry.oldPath,
    lines: stats.get(entry.path) ?? 'unweighed',
  }));

const comparedEntry = (entry: ComparedRow): ComparedPath => ({
  path: entry.path,
  status: entry.status,
  oldPath: entry.oldPath,
  lines: entry.lines,
});

const conflicted = (entries: readonly StatusRow[]): ComparedPath[] =>
  entries.map((entry) => ({ path: entry.path, status: entry.status, lines: 'unweighed' }));

const entriesOf = (paths: readonly ComparedPath[]): CheckoutEntry[] => paths.map((entry) => ({ ...entry }));

export const mergeScopedReading = (previous: TreeReading, fresh: TreeReading, paths: readonly string[]): TreeReading => {
  const scopes = new Set(paths);
  const status: Status = {
    ...fresh.status,
    entries: {
      staged: mergeScoped(previous.status.entries.staged, fresh.status.entries.staged, scopes),
      unstaged: mergeScoped(previous.status.entries.unstaged, fresh.status.entries.unstaged, scopes),
      untracked: mergeScoped(previous.status.entries.untracked, fresh.status.entries.untracked, scopes),
      unmerged: mergeScoped(previous.status.entries.unmerged, fresh.status.entries.unmerged, scopes),
    },
    coverage: previous.status.coverage,
  };
  const areas: Areas = {
    staged: mergeScoped(previous.areas.staged, fresh.areas.staged, scopes),
    unstaged: mergeScoped(previous.areas.unstaged, fresh.areas.unstaged, scopes),
    untracked: mergeScoped(previous.areas.untracked, fresh.areas.untracked, scopes),
    unmerged: mergeScoped(previous.areas.unmerged, fresh.areas.unmerged, scopes),
  };
  return { ...fresh, status, areas };
};

export const sharedTreeCell = (trees: Map<RootId, SharedTree>, rootId: RootId): SharedTree => {
  const standing = trees.get(rootId);
  if (standing !== undefined) return standing;
  const tree: SharedTree = { epoch: 0, taken: null, why: new Set(), paths: null };
  trees.set(rootId, tree);
  return tree;
};

export const compareBase = Effect.fn('CheckoutRows.compareBase')(function* (
  shared: SharedReading,
  state: ReadingState,
  base: string,
  head: string | null,
): Effect.fn.Return<Comparison, GitUnreadable | GitRefused | GitAnswerInvalid> {
  const tip = yield* commitOf(shared.git, state.dir, base, { capture: READING_CAPTURE });
  const kept = shared.compared.get(state.key);
  if (kept !== undefined && tip !== null && head !== null && kept.base === base && kept.tip === tip && kept.head === head) {
    return kept.result;
  }
  const result = yield* compareAt(shared.git, state.dir, tip ?? base, head ?? 'HEAD', { capture: READING_CAPTURE });
  if (tip === null || head === null) shared.compared.delete(state.key);
  else shared.compared.set(state.key, { base, tip, head, result });
  return result;
});

export const sharedTree = (shared: SharedReading, state: ReadingState): Effect.Effect<TreeReading, GitFailure> =>
  Effect.suspend(() => {
    const tree = sharedTreeCell(shared.trees, state.rootId);
    const standing = tree.taken;
    if (standing !== null && standing.epoch === null) return Effect.catch(Deferred.await(standing.done), () => sharedTree(shared, state));
    if (standing !== null && standing.epoch === tree.epoch) return Deferred.await(standing.done);
    const done = Deferred.makeUnsafe<TreeReading, GitFailure>();
    const previous = tree.taken;
    const taken: NonNullable<SharedTree['taken']> = { epoch: null, done };
    tree.taken = taken;
    const asked: { paths: Set<string> | null | undefined; refs: boolean } = { paths: undefined, refs: false };
    const unannounced = (): boolean => asked.refs && asked.paths !== null && asked.paths !== undefined;
    const readers = shared.readerCountOf(state.rootId);
    return Effect.gen(function* () {
      const earlier = previous === null ? null : yield* Effect.option(Deferred.await(previous.done));
      const kept = earlier === null || earlier._tag === 'None' ? null : earlier.value;
      const fresh = yield* boundedReading(
        shared,
        state,
        Effect.suspend(() => {
          const paths = tree.paths;
          taken.epoch = tree.epoch;
          asked.paths = paths;
          const metadata: Metadata = { refs: tree.why.has('refs') || tree.why.has('head'), operation: tree.why.has('operation') };
          asked.refs = metadata.refs;
          tree.paths = new Set();
          const reason = [...tree.why].sort().join(' ');
          tree.why.clear();
          return Effect.andThen(
            Effect.annotateCurrentSpan('checkout.reason', reason === '' ? 'marked' : reason),
            kept === null || paths === null || !pathspecFits(paths)
              ? readTree(shared, state)
              : paths.size === 0
                ? readMetadata(shared, state, kept, metadata)
                : readTree(shared, state, kept, [...paths]),
          );
        }),
      );
      if (
        unannounced() &&
        (kept === null || fresh.status.branch.head !== kept.status.branch.head || fresh.status.branch.ref !== kept.status.branch.ref)
      )
        yield* shared.treeChanged(state.rootId);
      return fresh;
    }).pipe(
      Effect.withSpan('CheckoutStatus.reading', {
        root: true,
        attributes: {
          'checkout.root': state.rootId,
          'checkout.path': state.dir,
          'checkout.readers': readers,
        },
      }),
      Effect.onExit((exit) =>
        Effect.suspend(() => {
          if (exit._tag === 'Failure' && tree.taken?.done === done) tree.taken = null;
          const changed = exit._tag === 'Failure' && unannounced() ? shared.treeChanged(state.rootId) : Effect.void;
          return changed.pipe(Effect.ensuring(Deferred.done(done, exit)));
        }),
      ),
    );
  });

export const boundedReading = <A, E>(
  shared: SharedReading,
  state: ReadingState,
  work: Effect.Effect<A, E>,
): Effect.Effect<A, E | GitUnreadable> =>
  Effect.suspend(() => {
    const asked = performance.now();
    return shared.readings.within(
      Effect.andThen(
        Effect.annotateCurrentSpan('queue.ms', Math.round(performance.now() - asked)),
        Effect.timeoutOrElse(work, {
          duration: READING_DEADLINE,
          orElse: () =>
            Effect.fail(
              new GitUnreadable({
                command: ['git', '-C', state.dir],
                reason: `the checkout reading ran past ${READING_DEADLINE} and was stopped`,
              }),
            ),
        }),
      ),
    );
  });

const readMetadata = Effect.fn('CheckoutRows.readReferences')(function* (
  shared: SharedReading,
  state: ReadingState,
  previous: TreeReading,
  metadata: Metadata,
): Effect.fn.Return<TreeReading, GitFailure> {
  let fresh = previous;
  if (metadata.refs) {
    const branch = yield* refreshBranch(shared.git, state.dir, previous.status.branch, { capture: READING_CAPTURE });
    if (branch === null || branch.head !== previous.status.branch.head || branch.ref !== previous.status.branch.ref)
      return yield* readTree(shared, state);
    const publishTo =
      branch.ref === previous.status.branch.ref && branch.upstream === previous.status.branch.upstream
        ? previous.publishTo
        : branch.ref !== null && branch.upstream === null
          ? yield* publishRemoteAt(shared.git, state.dir, branch.ref, { capture: READING_CAPTURE })
          : null;
    fresh = { ...previous, status: { ...previous.status, branch }, publishTo };
  }
  if (!metadata.operation) return fresh;
  return { ...fresh, sequencer: yield* sequencerAt(shared.git, state.dir, READING_CAPTURE) };
});

export const readTree = Effect.fn('CheckoutRows.readTree')(function* (
  shared: SharedReading,
  state: ReadingState,
  previous?: TreeReading,
  paths?: readonly string[],
): Effect.fn.Return<TreeReading, GitFailure> {
  const scoped = previous !== undefined && paths !== undefined;
  const [took, status] = yield* Effect.timed(
    statusAt(shared.git, state.dir, {
      untracked: 'all',
      capture: READING_CAPTURE,
      paths: scoped ? paths.map(literal) : undefined,
    }),
  );
  if (
    scoped &&
    (status.branch.head !== previous.status.branch.head ||
      status.branch.ref !== previous.status.branch.ref ||
      status.branch.upstream !== previous.status.branch.upstream)
  ) {
    return yield* readTree(shared, state);
  }
  const [probed, sequencer] = yield* Effect.timed(sequencerAt(shared.git, state.dir, READING_CAPTURE));
  const statusMs = scoped ? previous.statusMs : Duration.toMillis(took) + Duration.toMillis(probed);
  const upstream = status.branch.upstream;
  const ref = status.branch.ref;
  const [{ staged, unstaged }, publishTo] = yield* Effect.all(
    [
      Effect.gen(function* () {
        const options = { capture: READING_CAPTURE, paths: scoped ? paths : undefined };
        const staged =
          status.entries.staged.length === 0 ? UNWEIGHED : weighed(yield* numstatAt(shared.git, state.dir, { ...options, cached: true }));
        const unstaged = status.entries.unstaged.length === 0 ? UNWEIGHED : weighed(yield* numstatAt(shared.git, state.dir, options));
        return { staged, unstaged };
      }),
      scoped
        ? Effect.succeed(previous.publishTo)
        : ref !== null && upstream === null
          ? publishRemoteAt(shared.git, state.dir, ref, { capture: READING_CAPTURE })
          : Effect.succeed(null),
    ],
    { concurrency: 2 },
  );
  const untracked = yield* Effect.forEach(
    status.entries.untracked,
    (entry) =>
      Effect.map(untrackedWeight(shared.files, state.dir, entry.path), (lines) => ({
        path: entry.path,
        status: entry.status,
        lines,
      })),
    { concurrency: OPEN_FILES },
  );
  const areas: Areas = {
    staged: tracked(status.entries.staged, staged),
    unstaged: tracked(status.entries.unstaged, unstaged),
    untracked,
    unmerged: conflicted(status.entries.unmerged),
  };
  const fresh = { status, sequencer, statusMs, publishTo, areas };
  return scoped ? mergeScopedReading(previous, fresh, paths) : fresh;
});

export const readRow = Effect.fn('CheckoutRows.readRow')(function* (
  shared: SharedReading,
  state: ReadingState,
  revision: number,
): Effect.fn.Return<CheckoutState, GitFailure> {
  const { status, sequencer, statusMs, publishTo, areas } = yield* sharedTree(shared, state);
  const upstream = status.branch.upstream;
  const against = state.base ?? upstream;
  const measured =
    against === null
      ? null
      : yield* Effect.result(
          boundedReading(shared, state, compareBase(shared, state, against, status.branch.head)).pipe(
            Effect.withSpan('CheckoutStatus.comparison', { root: true }),
          ),
        );
  const compared = measured === null || measured._tag === 'Failure' ? null : measured.success;
  const unresolvedBase = measured !== null && measured._tag === 'Failure' && state.base !== null ? state.base : null;
  return {
    rootId: state.rootId,
    path: state.dir,
    revision,
    head: status.branch.head,
    ref: status.branch.ref,
    upstream,
    publishTo,
    ahead: status.branch.ahead,
    behind: status.branch.behind,
    operation: sequencer,
    entries: {
      staged: areaOf(entriesOf(areas.staged)),
      unstaged: areaOf(entriesOf(areas.unstaged)),
      untracked: areaOf(entriesOf(areas.untracked)),
      unmerged: areaOf(entriesOf(areas.unmerged)),
    },
    unresolvedBase,
    compare:
      compared === null || against === null || compared.outcome === 'no-merge-base'
        ? null
        : {
            base: against,
            mergeBase: compared.mergeBase,
            head: compared.head,
            entries: compared.entries.map(comparedEntry),
            added: compared.added,
            removed: compared.removed,
          },
    coverage: { untracked: status.coverage.untracked, paths: status.coverage.paths },
    repository: true,
    incomplete: false,
    stale: false,
    unwatched: state.watch === null || !state.watch.watching(),
    slowStatus: statusMs !== null && statusMs > SLOW_STATUS_MS,
  };
});
