import { join } from 'node:path';
import { Clock, Effect, FileSystem, type PlatformError, Result } from 'effect';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { chunk, unique } from '@runlith/utils/collection';
import { contentDigest, streamedDigest, versionContentLimit } from '@runlith/files/content';
import { exactWorkingAt, listingUnder, type Working } from '@runlith/files/working';
import type { Git } from '@runlith/git/Git';
import { changedBetween, visibleAmong } from '@runlith/git/entries';
import { commitOf } from '@runlith/git/repository';
import { pathspecFits, statusAt } from '@runlith/git/status';
import { conversionsAt, normalizedAt, workingBlobFilesAt, type Conversions } from '@runlith/git/working';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { configuredGit, OwnGitFailed } from '../../platform/git/ownGit.js';
import type { HoldingGit } from '../contract/wire/holdings.js';
import type { HeadSide } from '../contract/service/holdings.js';
import { contentOf, digestOf, type Content, type FoldRow, type FoldState } from '../lines/folding.js';
import type { FoldInput } from '../lines/fold.js';
import type { Lane, Walks, WalkUnfinished } from '../lines/walks.js';
import { commandUnattributed } from '../store/commandTables.js';
import { followsStanding, standing, workspaceChange, workspaceChangeContent, workspaceChangeText } from '../store/tables.js';
import { versionTexts } from '../record/evidence.js';
import { movesAt, NO_MOVES } from '../record/moves.js';
import { hunksOf, type HunkRow } from '../record/hunks.js';
import { PLACES_PER_STATEMENT, type StoreShape } from '../record/places.js';
import { headsAt, headsRead, type HeadsRead, WHOLE_TREE } from './heads.js';
import { confirmedAt, lettersAt } from './letters.js';

export type InputReaders = {
  readonly store: StoreShape;
  readonly units: MachineUnits['Service'];
  readonly git: Git['Service'];
  readonly files: FileSystem.FileSystem;
  readonly walks: Walks;
};

export type Checkout = { readonly rootId: string; readonly dir: string };

export type StoredRow = HunkRow & {
  readonly holder: string;
  readonly state: 'writing' | 'held' | 'ended';
  readonly runId: string | null;
  readonly origin: 'edit' | 'write' | 'delete';
  readonly movedFrom: string | null;
  readonly reverts: readonly string[] | null;
  readonly beforeKept: boolean;
  readonly afterKept: boolean;
};

export type Unattributed = {
  readonly windows: readonly { readonly thread: string; readonly reason: string; readonly team: string | null }[];
};

export type Probe = {
  readonly path: string;
  readonly rows: readonly StoredRow[];
  readonly head: HeadSide;
  readonly working: Working;
  readonly git: HoldingGit | undefined;
  readonly from: string | null;
  readonly unattributed: Unattributed | null;
  readonly stable: string;
  readonly print: string;
};

export type Probed = {
  readonly head: string | null;
  readonly status: { readonly read: true } | { readonly read: false; readonly cause: string };
  readonly probes: ReadonlyMap<string, Probe>;
};

export type Prepared = { readonly input: FoldInput; readonly print: string; readonly recalled: boolean };

export type Remembered = (path: string) => FoldState | undefined;

export type Known = Result.Result<Conversions, { readonly message: string }>;

export const conversionsOf = (readers: InputReaders, checkout: Checkout, paths: readonly string[]): Effect.Effect<Known> =>
  Effect.result(conversionsAt(configuredGit(readers.git, 'holdings-conversions'), checkout.dir, paths));

export const headShiftAt = (readers: InputReaders, checkout: Checkout, from: string, to: string) =>
  Effect.result(changedBetween(configuredGit(readers.git, 'holdings-head'), checkout.dir, from, to));

const EMPTY = contentDigest('');

const STATS_AT_ONCE = 64;

const READS_AT_ONCE = 8;

const literal = (path: string): string => `:(literal)${path}`;

const causeOf = (failure: { readonly message: string }): string => failure.message;

export const standingOf = <Row extends Pick<StoredRow, 'state'>>(rows: readonly Row[]): readonly Row[] =>
  rows.filter((row) => row.state !== 'ended');

export const rowsAt = Effect.fn('Holdings.rows')(function* (
  readers: InputReaders,
  checkout: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, readonly StoredRow[]>, StoreFailure> {
  const kept = (digest: typeof workspaceChange.beforeHash) =>
    sql<number>`exists(select 1 from ${workspaceChangeContent} where ${workspaceChangeContent.digest} = ${digest})`;
  const columns = {
    id: workspaceChange.id,
    path: workspaceChange.path,
    holder: workspaceChange.holder,
    state: workspaceChange.state,
    runId: workspaceChange.runId,
    origin: workspaceChange.origin,
    movedFrom: workspaceChange.movedFrom,
    beforeHash: workspaceChange.beforeHash,
    afterHash: workspaceChange.afterHash,
    firstLine: workspaceChange.firstLine,
    newLines: workspaceChange.lines,
    oldLines: workspaceChange.oldLines,
    windowBefore: workspaceChange.windowBefore,
    reverts: workspaceChange.reverts,
    beforeKept: kept(workspaceChange.beforeHash),
    afterKept: kept(workspaceChange.afterHash),
    at: workspaceChange.at,
  };
  const found = new Map<string, StoredRow[]>();
  for (const group of chunk(unique(paths), PLACES_PER_STATEMENT)) {
    const placed = and(eq(workspaceChange.checkout, checkout), inArray(workspaceChange.path, group));
    const starts = readers.store.db
      .select({ path: sql<string>`${workspaceChange.path}`.as('start_path'), at: sql<number>`min(${workspaceChange.at})`.as('start_at') })
      .from(workspaceChange)
      .where(and(placed, standing))
      .groupBy(workspaceChange.path)
      .as('starts');
    const rows = yield* readers.units.read((unit) =>
      unit.run(
        readers.store.db
          .select(columns)
          .from(workspaceChange)
          .where(and(placed, standing))
          .unionAll(
            readers.store.db
              .select(columns)
              .from(starts)
              .innerJoin(
                workspaceChange,
                and(eq(workspaceChange.checkout, checkout), eq(workspaceChange.path, starts.path), gte(workspaceChange.at, starts.at)),
              )
              .where(and(ended, followsStanding, hunked)),
          ),
      ),
    );
    const ordered = [...rows].sort((one, two) => one.at.getTime() - two.at.getTime() || (one.id < two.id ? -1 : one.id > two.id ? 1 : 0));
    for (const { path, state, beforeKept, afterKept, at: _at, ...row } of ordered) {
      const window = found.get(path) ?? [];
      const stored: StoredRow = {
        ...row,
        state: state === 'writing' || state === 'held' ? state : 'ended',
        beforeKept: Boolean(beforeKept),
        afterKept: Boolean(afterKept),
      };
      if (replayable(window, stored)) window.push(stored);
      found.set(path, window);
    }
  }
  return found;
});

const ended = sql`${workspaceChange.state} in ('committed', 'withdrawn')`;

const hunked = sql`exists(select 1 from ${workspaceChangeText} where ${workspaceChangeText.row} = ${workspaceChange.id})`;

const replayable = (window: readonly StoredRow[], row: StoredRow): boolean => {
  if (row.state !== 'ended') return true;
  const previous = window.at(-1);
  const chained = previous !== undefined && afterDigestOf(previous) === row.beforeHash;
  return (chained || row.beforeKept) && (row.reverts === null || row.reverts.length === 0 || row.afterKept);
};

export const heldPathsAt = Effect.fn('Holdings.domain')(function* (
  readers: InputReaders,
  checkout: string,
): Effect.fn.Return<readonly string[], StoreFailure> {
  const rows = yield* readers.units.read((unit) =>
    unit.run(
      readers.store.db
        .selectDistinct({ path: workspaceChange.path })
        .from(workspaceChange)
        .where(and(eq(workspaceChange.checkout, checkout), standing)),
    ),
  );
  return rows.map((row) => row.path);
});

const unattributedAt = Effect.fn('Holdings.unattributed')(function* (
  readers: InputReaders,
  checkout: string,
  paths: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, Unattributed>, StoreFailure> {
  type Window = { readonly reason: string; readonly team: string | null; readonly at: number };
  const found = new Map<string, Map<string, Window>>();
  for (const group of chunk(unique(paths), PLACES_PER_STATEMENT)) {
    const rows = yield* readers.units.read((unit) =>
      unit.run(
        readers.store.db
          .select({
            path: commandUnattributed.path,
            thread: commandUnattributed.threadId,
            reason: commandUnattributed.reason,
            team: commandUnattributed.team,
            at: commandUnattributed.at,
          })
          .from(commandUnattributed)
          .where(and(eq(commandUnattributed.checkout, checkout), inArray(commandUnattributed.path, group))),
      ),
    );
    for (const row of rows) {
      const threads = found.get(row.path) ?? new Map<string, Window>();
      if ((threads.get(row.thread)?.at ?? -1) < row.at) threads.set(row.thread, row);
      found.set(row.path, threads);
    }
  }
  return new Map(
    [...found].map(([path, threads]) => {
      const windows = [...threads]
        .sort(([, one], [, other]) => other.at - one.at)
        .map(([thread, one]) => ({ thread, reason: one.reason, team: one.team }));
      return [path, { windows }] as const;
    }),
  );
});

const rowsKey = (rows: readonly StoredRow[]): string =>
  rows.map((row) => `${row.id}:${row.state}:${row.afterHash ?? ''}:${row.beforeKept ? 1 : 0}${row.afterKept ? 1 : 0}`).join(',');

const headKey = (head: HeadSide): string =>
  head.kind === 'blob' ? `${head.mode}:${head.oid}` : head.kind === 'absent' ? 'absent' : `unread:${head.cause}`;

const workingKey = (working: Working): string =>
  working.kind === 'unread' ? 'unread' : working.kind === 'absent' ? 'absent' : (working.key ?? 'young');

export const young = (probe: Probe): boolean =>
  probe.working.kind !== 'absent' && probe.working.kind !== 'unread' && probe.working.key === null;

export const probeAt = Effect.fn('Holdings.probe')(function* (
  readers: InputReaders,
  checkout: Checkout,
  requested: readonly string[],
  {
    scope,
    expected,
    heads: known = headsRead(),
  }: { readonly scope: 'candidates' | 'required'; readonly expected?: string; readonly heads?: HeadsRead },
): Effect.fn.Return<Probed, StoreFailure> {
  const scoped = requested.length <= WHOLE_TREE && pathspecFits(requested);
  const [rows, status] = yield* Effect.all(
    [
      rowsAt(readers, checkout.rootId, requested),
      Effect.result(
        statusAt(configuredGit(readers.git, 'holdings-status'), checkout.dir, {
          untracked: 'no',
          paths: scoped ? requested.map(literal) : undefined,
          monitor: !scoped,
        }),
      ),
    ],
    { concurrency: 2 },
  );
  const tracked = Result.map(
    status,
    ({ entries }) =>
      new Set(
        [entries.unmerged, entries.staged, entries.unstaged].flatMap((area) =>
          area.flatMap((row) => (row.oldPath === undefined ? [row.path] : [row.path, row.oldPath])),
        ),
      ),
  );
  const sides =
    Result.isSuccess(status)
      ? yield* headsAt(readers.git, checkout.dir, status.success.branch.head, requested, known)
      : new Map<string, HeadSide>();
  const candidates = requested.filter(
    (path) => sides.get(path)?.kind === 'absent' && tracked._tag === 'Success' && !tracked.success.has(path),
  );
  const visible = yield* Effect.result(
    visibleAmong(configuredGit(readers.git, 'holdings-visible'), checkout.dir, candidates).pipe(
      Effect.provideService(FileSystem.FileSystem, readers.files),
    ),
  );
  const paths =
    scope === 'required'
      ? requested
      : requested.filter(
          (path) =>
            rows.has(path) ||
            tracked._tag === 'Failure' ||
            tracked.success.has(path) ||
            sides.get(path)?.kind !== 'absent' ||
            visible._tag === 'Failure' ||
            visible.success.has(path),
        );
  yield* Effect.annotateCurrentSpan({ 'holdings.ignored': requested.length - paths.length });
  if (paths.length === 0)
    return {
      head: status._tag === 'Success' ? status.success.branch.head : (expected ?? null),
      status:
        status._tag === 'Failure'
          ? { read: false, cause: causeOf(status.failure) }
          : visible._tag === 'Failure'
            ? { read: false, cause: causeOf(visible.failure) }
            : { read: true },
      probes: new Map(),
    };
  const unattributed = yield* unattributedAt(readers, checkout.rootId, paths);
  const early =
    expected === undefined || status._tag === 'Success' ? undefined : yield* headsAt(readers.git, checkout.dir, expected, paths, known);
  const tip: Result.Result<string | null, string> =
    status._tag === 'Success'
      ? Result.succeed(status.success.branch.head)
      : yield* Effect.map(Effect.result(commitOf(configuredGit(readers.git, 'holdings-head'), checkout.dir, 'HEAD')), (read) =>
          read._tag === 'Success' ? Result.succeed(read.success) : Result.fail(causeOf(read.failure)),
        );
  const { head, heads }: { readonly head: string | null; readonly heads: ReadonlyMap<string, HeadSide> } =
    tip._tag === 'Failure'
      ? { head: null, heads: new Map(paths.map((path) => [path, { kind: 'unread', cause: tip.failure } as const])) }
      : {
          head: tip.success,
          heads:
            early !== undefined && tip.success === expected ? early : yield* headsAt(readers.git, checkout.dir, tip.success, paths, known),
        };
  const now = yield* Clock.currentTimeMillis;
  const listing = listingUnder(checkout.dir);
  const stats = yield* Effect.forEach(paths, (path) => exactWorkingAt(listing, path, now), { concurrency: STATS_AT_ONCE });
  const working = new Map(paths.map((path, at) => [path, stats[at] as Working] as const));
  const silent =
    scoped || tracked._tag === 'Failure'
      ? []
      : paths.filter(
          (path) =>
            !tracked.success.has(path) && heads.get(path)?.kind === 'blob' && (rows.has(path) || working.get(path)?.kind === 'absent'),
        );
  const told = status._tag === 'Failure' ? status : yield* confirmedAt(readers.git, checkout.dir, status.success, silent);
  const read =
    told._tag === 'Failure'
      ? causeOf(told.failure)
      : visible._tag === 'Failure'
        ? causeOf(visible.failure)
        : lettersAt(paths, told.success, heads, working, visible.success);
  const fresh = paths.filter((path) => {
    const bytes = working.get(path);
    return heads.get(path)?.kind === 'absent' && bytes !== undefined && bytes.kind !== 'absent' && bytes.kind !== 'unread';
  });
  const staged = typeof read !== 'string' && fresh.some((path) => read.added.has(path));
  const moving =
    fresh.length === 0
      ? Result.succeed(NO_MOVES)
      : yield* Effect.result(movesAt(readers, { checkout: checkout.rootId, dir: checkout.dir, head }, fresh, staged));
  if (moving._tag === 'Failure' && !(moving.failure instanceof OwnGitFailed)) return yield* moving.failure;
  const lettered = moving._tag === 'Failure' ? `the staged moves could not be read: ${moving.failure.message}` : read;
  const moves = moving._tag === 'Success' ? moving.success : NO_MOVES;
  const probes = new Map<string, Probe>();
  for (const path of paths) {
    const held = rows.get(path) ?? [];
    const side = heads.get(path) ?? ({ kind: 'unread', cause: 'the tree reader answered nothing for the path' } as const);
    const bytes = working.get(path) ?? ({ kind: 'unread', cause: 'the stat answered nothing for the path' } as const);
    const git = typeof lettered === 'string' ? undefined : (lettered.letters.get(path) ?? null);
    const from = moves.sourceOf(path);
    const named = unattributed.get(path) ?? null;
    const stable = [
      rowsKey(held),
      headKey(side),
      git === undefined ? 'status-unread' : String(git),
      from ?? '',
      named === null ? '' : named.windows.map((one) => `${one.thread}:${one.reason}`).join(','),
    ].join('\n');
    probes.set(path, {
      path,
      rows: held,
      head: side,
      working: bytes,
      git,
      from,
      unattributed: named,
      stable,
      print: `${stable}\n${workingKey(bytes)}`,
    });
  }
  return {
    head,
    status: typeof lettered === 'string' ? { read: false, cause: lettered } : { read: true },
    probes,
  };
});

const unwalked = (failure: WalkUnfinished): Content => ({ kind: 'unread', cause: failure.reason });

const decoded = (readers: InputReaders, bytes: Uint8Array, lane: Lane, blob?: string): Effect.Effect<Content> =>
  Effect.match(readers.walks.file(bytes, blob, lane), { onFailure: unwalked, onSuccess: (content) => content });

const unreadSide = (failure: PlatformError.PlatformError): Content => ({ kind: 'unread', cause: failure.message });

const workingContent = (readers: InputReaders, dir: string, path: string, working: Working, lane: Lane): Effect.Effect<Content> => {
  const file = join(dir, path);
  if (working.kind === 'unread') return Effect.succeed({ kind: 'unread', cause: `${path} could not be read on disk: ${working.cause}` });
  if (working.kind === 'absent') return Effect.succeed(contentOf(null));
  if (working.kind === 'link')
    return Effect.match(readers.files.readLink(file), {
      onFailure: unreadSide,
      onSuccess: (target): Content => ({ kind: 'whole', digest: contentDigest(target) }),
    });
  if (working.size > versionContentLimit)
    return Effect.match(streamedDigest(readers.files, file), {
      onFailure: unreadSide,
      onSuccess: (digest): Content => ({ kind: 'whole', digest }),
    });
  return Effect.matchEffect(readers.files.readFile(file), {
    onFailure: (failure) => Effect.succeed(unreadSide(failure)),
    onSuccess: (bytes) => decoded(readers, bytes, lane),
  });
};

export const workingDigestAt = (
  readers: InputReaders,
  checkout: Checkout,
  probe: Probe,
  lane: Lane,
): Effect.Effect<Result.Result<string | null, string>> => {
  const { working } = probe;
  if (working.kind !== 'file' || working.size > versionContentLimit)
    return Effect.map(workingContent(readers, checkout.dir, probe.path, working, lane), (side) =>
      side.kind === 'unread' ? Result.fail(side.cause) : Result.succeed(side.digest),
    );
  return Effect.match(
    Effect.flatMap(readers.files.readFile(join(checkout.dir, probe.path)), (bytes) => readers.walks.digests([bytes], lane)),
    {
      onFailure: (failure) => Result.fail(failure._tag === 'WalkUnfinished' ? failure.reason : failure.message),
      onSuccess: ([digest]) => (digest === undefined ? Result.fail('the walk answered no digest') : Result.succeed(digest)),
    },
  );
};

export type BlobRead = { readonly path: string; readonly blob: string };

export const blobContents = Effect.fnUntraced(function* (
  readers: InputReaders,
  dir: string,
  asked: readonly BlobRead[],
  lane: Lane,
  conversions?: Conversions,
): Effect.fn.Return<readonly (Content | 'oversized')[]> {
  const files = yield* workingBlobFilesAt(configuredGit(readers.git, 'holdings-texts'), dir, asked, {
    capture: versionContentLimit,
    conversions,
  });
  return yield* Effect.forEach(
    asked,
    (one, at): Effect.Effect<Content | 'oversized'> => {
      const file = files[at];
      if (file === undefined) return Effect.succeed({ kind: 'unread', cause: 'the blob reader answered nothing for the path' });
      if (file._tag === 'Failure')
        return Effect.succeed(file.failure._tag === 'GitAnswerInvalid' ? 'oversized' : { kind: 'unread', cause: causeOf(file.failure) });
      if (file.success === null) return Effect.succeed(contentOf(null));
      return decoded(readers, file.success, lane, one.blob);
    },
    { concurrency: 'unbounded' },
  );
});

type Versions = ReadonlyMap<string, Content>;

const versioned = (digest: string | null, versions: Versions): Content =>
  digest === null ? contentOf(null) : (versions.get(digest) ?? { kind: 'opaque', digest });

const beforeOf = (row: StoredRow, versions: Versions): Content =>
  row.origin === 'delete' && row.beforeHash === null ? { kind: 'opaque', digest: null } : versioned(row.beforeHash, versions);

const afterOf = (row: StoredRow, versions: Versions): Content =>
  row.origin === 'delete' ? contentOf(null) : versioned(row.afterHash, versions);

const afterDigestOf = (row: StoredRow): string | null => (row.origin === 'delete' ? null : row.afterHash);

const NO_VERSIONS: Versions = new Map();

const baseDigestOf = (first: StoredRow | undefined, head: Content): string | null | undefined => {
  if (first === undefined) return null;
  if (first.beforeHash === EMPTY && head.kind === 'absent') return null;
  if (first.beforeHash === null) return null;
  return first.beforeKept ? first.beforeHash : digestOf(head);
};

const prefixOf = (state: FoldState, one: Sided, normalized: boolean): number => {
  if (state.normalized !== normalized || digestOf(state.base) !== baseDigestOf(one.rows[0], one.head)) return 0;
  const kept: FoldRow[] = [];
  for (let link = state.rows; link !== null; link = link.previous) kept.push(link.row);
  if (kept.length > one.rows.length) return 0;
  kept.reverse();
  for (const [at, row] of kept.entries()) {
    const current = one.rows[at] as StoredRow;
    if (current.id !== row.id || afterDigestOf(current) !== digestOf(row.after)) return 0;
  }
  return kept.length;
};

const foldRowsOf = (
  rows: readonly StoredRow[],
  versions: Versions,
  workings: Versions,
  start: Content,
  hunks: ReadonlyMap<string, FoldRow['hunk']>,
  recalledRows: number,
): readonly FoldRow[] => {
  const folded: FoldRow[] = [];
  let previous: Content = start;
  for (const [at, row] of rows.entries()) {
    const recalled = at < recalledRows;
    const absentBefore = row.beforeHash === EMPTY && (folded.length === 0 ? start.kind === 'absent' : previous.kind === 'absent');
    const before = absentBefore ? contentOf(null) : beforeOf(row, recalled ? NO_VERSIONS : versions);
    const after = afterOf(row, recalled ? workings : versions);
    const hunk = recalled ? undefined : hunks.get(row.id);
    folded.push({
      id: row.id,
      holder: row.holder,
      before,
      after,
      hunk,
      reverts: row.reverts === null || row.reverts.length === 0 ? undefined : row.reverts,
    });
    previous = after;
  }
  return folded;
};

const returns = (side: Content): boolean => side.kind === 'text' && side.text.includes('\r');

const digestPrint = (side: Content): string =>
  side.kind === 'unread' ? `unread:${side.cause}` : side.kind === 'absent' ? 'absent' : `${side.kind}:${side.digest ?? ''}`;

export type Sided = { readonly path: string; readonly rows: readonly StoredRow[]; readonly head: Content; readonly working: Content };

const digestsOf = (rows: readonly StoredRow[]): readonly string[] =>
  rows.flatMap((row) => [row.beforeHash, row.afterHash]).filter((digest): digest is string => digest !== null);

const readTexts = (readers: InputReaders, digests: readonly string[]): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> =>
  digests.length === 0 ? Effect.succeed(new Map<string, string>()) : versionTexts(readers.units, readers.store, digests);

export const textsOf = (readers: InputReaders, rows: readonly StoredRow[]): Effect.Effect<ReadonlyMap<string, string>, StoreFailure> =>
  readTexts(readers, digestsOf(rows));

const unhunked = (
  rows: readonly StoredRow[],
  from: number,
  hunks: ReadonlyMap<string, FoldRow['hunk']>,
): { readonly digests: readonly string[]; readonly skipped: boolean } => {
  const digests: string[] = [];
  let skipped = false;
  const first = rows[0];
  if (from === 0 && first !== undefined && first.beforeHash !== null) digests.push(first.beforeHash);
  for (let at = from; at < rows.length; at += 1) {
    const row = rows[at] as StoredRow;
    const chained = at === 0 || rows[at - 1]?.afterHash === row.beforeHash;
    if (hunks.has(row.id) && chained && (row.reverts === null || row.reverts.length === 0)) skipped = true;
    else digests.push(...digestsOf([row]));
  }
  return { digests, skipped };
};

const versionsOf = Effect.fnUntraced(function* (
  readers: InputReaders,
  rows: readonly StoredRow[],
  texts: ReadonlyMap<string, string>,
  workings: Versions,
  lane: Lane,
): Effect.fn.Return<Versions> {
  const wanted = unique(rows.flatMap((row) => [row.beforeHash, row.afterHash])).filter(
    (digest): digest is string => digest !== null && texts.has(digest) && !workings.has(digest),
  );
  const prepared = yield* Effect.forEach(
    wanted,
    (digest) =>
      Effect.match(readers.walks.content(texts.get(digest) as string, digest, lane), { onFailure: unwalked, onSuccess: (one) => one }),
    { concurrency: 'unbounded' },
  );
  const versions = new Map(workings);
  for (const [at, digest] of wanted.entries()) versions.set(digest, prepared[at] as Content);
  return versions;
});

export const assembled = Effect.fnUntraced(function* (
  readers: InputReaders,
  dir: string,
  sided: readonly Sided[],
  lane: Lane,
  known?: Known,
  stored?: ReadonlyMap<string, string>,
  recordedHunks?: ReadonlyMap<string, FoldRow['hunk']>,
  remembered?: Remembered,
  deferred?: boolean,
): Effect.fn.Return<ReadonlyMap<string, Prepared>, StoreFailure> {
  const recalls = new Map<string, { readonly state: FoldState; readonly rows: number }>();
  if (remembered !== undefined && known?._tag === 'Success')
    for (const one of sided) {
      const state = remembered(one.path);
      const rows = state === undefined ? 0 : prefixOf(state, one, known.success.normalized.has(one.path));
      if (state !== undefined && rows > 0) recalls.set(one.path, { state, rows });
    }
  const unread = sided.flatMap(({ path, rows }) => rows.slice(recalls.get(path)?.rows ?? 0));
  const lean = deferred === true && stored === undefined && recordedHunks === undefined && known?._tag === 'Success';
  const leaned = new Set<string>();
  let texts: ReadonlyMap<string, string>;
  let hunks: ReadonlyMap<string, FoldRow['hunk']>;
  if (lean) {
    hunks = yield* hunksOf(readers.units, readers.store, unread);
    const wanted: string[] = [];
    for (const { path, rows } of sided) {
      const needed = unhunked(rows, recalls.get(path)?.rows ?? 0, hunks);
      wanted.push(...needed.digests);
      if (needed.skipped) leaned.add(path);
    }
    texts = yield* readTexts(readers, unique(wanted));
  } else {
    texts = stored ?? (yield* textsOf(readers, unread));
    hunks = recordedHunks ?? (yield* hunksOf(readers.units, readers.store, unread, texts));
  }
  yield* Effect.annotateCurrentSpan({ 'holdings.texts': texts.size, 'holdings.recalled': recalls.size });
  const workings = new Map(sided.flatMap(({ working }) => (working.kind === 'text' ? [[working.digest, working] as const] : [])));
  const versions = yield* versionsOf(readers, unread, texts, workings, lane);
  const prepared = new Map<string, { readonly sided: Sided; readonly rows: readonly FoldRow[]; readonly base: Content }>();
  for (const one of sided) {
    const recall = recalls.get(one.path);
    const first = one.rows[0];
    const start = first === undefined ? contentOf(null) : beforeOf(first, versions);
    const startBase =
      recall !== undefined
        ? recall.state.base
        : (start.kind === 'opaque' && start.digest !== null) || (first?.beforeHash === EMPTY && one.head.kind === 'absent')
          ? one.head
          : start;
    const rows = foldRowsOf(one.rows, versions, workings, startBase, hunks, recall?.rows ?? 0);
    prepared.set(one.path, { sided: one, rows, base: startBase });
  }
  const carriage =
    known?._tag === 'Success'
      ? []
      : [...prepared.values()]
          .filter(({ sided: one, rows, base }) =>
            [one.head, one.working, base, ...rows.flatMap((row) => [row.before, row.after])].some(returns),
          )
          .map(({ sided: one }) => one.path);
  const ends: Result.Result<ReadonlySet<string>, { readonly message: string }> | null =
    known !== undefined
      ? Result.map(known, (found) => found.normalized)
      : carriage.length === 0
        ? null
        : yield* Effect.result(normalizedAt(configuredGit(readers.git, 'holdings-ends'), dir, carriage));
  const carried = new Set(carriage);
  const answered = new Map<string, Prepared>();
  for (const [path, { sided: one, rows, base }] of prepared) {
    const unread = ends?._tag === 'Failure' && carried.has(path) ? ends.failure.message : null;
    const normalized = ends?._tag === 'Success' && ends.success.has(path);
    const working: Content =
      unread === null ? one.working : { kind: 'unread', cause: `how git treats line endings could not be read: ${unread}` };
    const ended = new Set(one.rows.flatMap((row) => (row.state === 'ended' ? [row.id] : [])));
    answered.set(path, {
      recalled: recalls.has(path),
      input: { base, head: one.head, working, rows, normalized, partial: leaned.has(path), ...(ended.size === 0 ? {} : { ended }) },
      print: `${digestPrint(one.head)}\n${digestPrint(working)}\n${normalized ? 'normalized' : 'raw'}`,
    });
  }
  return answered;
});

export const prepareAt = Effect.fn('Holdings.inputs')(function* (
  readers: InputReaders,
  checkout: Checkout,
  probes: readonly Probe[],
  lane: Lane,
  known?: Known,
  remembered?: Remembered,
  deferred?: boolean,
): Effect.fn.Return<ReadonlyMap<string, Prepared>, StoreFailure> {
  const asked = probes.flatMap((probe) => (probe.head.kind === 'blob' ? [{ path: probe.path, blob: probe.head.oid }] : []));
  const conversions = known?._tag === 'Success' ? known.success : undefined;
  const read = asked.length === 0 ? [] : yield* blobContents(readers, checkout.dir, asked, lane, conversions);
  const heads = new Map(asked.map((one, at) => [one.path, read[at] as Content | 'oversized'] as const));
  const workings = yield* Effect.forEach(probes, (probe) => workingContent(readers, checkout.dir, probe.path, probe.working, lane), {
    concurrency: READS_AT_ONCE,
  });
  const sided = probes.map((probe, at): Sided => {
    const working = workings[at] as Content;
    const read = heads.get(probe.path);
    const head: Content =
      probe.head.kind === 'unread'
        ? { kind: 'unread', cause: probe.head.cause }
        : probe.head.kind === 'absent'
          ? contentOf(null)
          : read === 'oversized'
            ? { kind: 'whole', digest: `blob:${probe.head.oid}` }
            : (read ?? { kind: 'unread', cause: 'the blob reader answered nothing for the path' });
    const clean = probe.git === null && head.kind === 'whole' && working.kind === 'whole';
    return { path: probe.path, rows: probe.rows, head: clean ? working : head, working };
  });
  return yield* assembled(readers, checkout.dir, sided, lane, known, undefined, undefined, remembered, deferred);
});
