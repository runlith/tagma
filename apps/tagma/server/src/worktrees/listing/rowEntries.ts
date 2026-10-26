import type { Result } from 'effect';
import type { CheckoutState } from '../../workspace/contract/wire/checkout.js';
import type { ProjectRoot } from '../../workspace/contract/wire/coverage.js';
import type { RootResolutionFailure } from '../../workspace/contract/wire/roots.js';
import type { PendingMerge } from '../contract/wire/mergeTypes.js';
import type { WorktreeAgents, WorktreeKind, WorktreeReading, WorktreeState } from '../contract/wire/rows.js';
import type { WorktreeRecord } from '../contract/service/worktrees.js';
import { UNTAKEN, type Distance, type Entry, type Reading, type Sight, type WorktreeEntries } from './rowShapes.js';
import type { ThreadPlacing } from '../contract/service/finishingGate.js';
import { byThread, strayOf } from './placings.js';
import { byKey } from './rowOrder.js';

const MAIN = 'main';

const RANKS: Partial<Record<WorktreeState, number>> = { waiting: 1, ready: 2, working: 3 };

const agentsOf = (placings: readonly ThreadPlacing[]): WorktreeAgents => ({
  working: placings.filter((one) => one.state === 'working').length,
  waiting: placings.filter((one) => one.state === 'waiting').length,
  finished: placings.filter((one) => one.state === 'finished').length,
  standing: placings.length,
});

const active = (placings: readonly ThreadPlacing[]): readonly string[] =>
  placings
    .filter((one) => one.state === 'working' || one.state === 'waiting')
    .map((one) => one.threadId)
    .sort();

const busy = (agents: WorktreeAgents): WorktreeState | null => (agents.waiting > 0 ? 'waiting' : agents.working > 0 ? 'working' : null);

export const summarize = (reading: CheckoutState): Reading => ({
  head: reading.head,
  ref: reading.ref,
  repository: reading.repository,
  stale: reading.stale,
  uncommitted: new Set(Object.values(reading.entries).flatMap((area) => area.entries.map((entry) => entry.path))).size,
  diff:
    reading.compare === null
      ? null
      : { files: reading.compare.entries.length, added: reading.compare.added, removed: reading.compare.removed },
});

const latest = (placings: readonly ThreadPlacing[], since: number): number =>
  placings.reduce((newest, one) => Math.max(newest, one.movedAt.getTime()), since);

export const sightOf = (
  kind: WorktreeKind,
  present: boolean,
  reading: Result.Result<CheckoutState, RootResolutionFailure> | null,
): Sight => {
  const read = reading?._tag === 'Success' && (kind === 'main' || reading.success.repository) ? summarize(reading.success) : null;
  if (kind === 'main') return { seen: true, present: true, gone: false, read };
  const gone =
    !present ||
    (kind === 'tagma' &&
      reading?._tag === 'Failure' &&
      (reading.failure._tag === 'RootMissing' || (reading.failure._tag === 'RootConflict' && reading.failure.reason === 'replaced')));
  return { seen: true, present, gone, read };
};

const unversioned = (sight: Sight): boolean => sight.read !== null && !sight.read.stale && !sight.read.repository;

const fresh = (sight: Sight): Reading | null => (sight.read === null || sight.read.stale || !sight.read.repository ? null : sight.read);

const readingOf = (sight: Sight): WorktreeReading =>
  !sight.seen
    ? 'pending'
    : unversioned(sight)
      ? 'no-repository'
      : fresh(sight) === null && sight.present && !sight.gone
        ? 'failed'
        : 'done';

const rested = (sight: Sight): WorktreeState => {
  const reading = readingOf(sight);
  return reading === 'failed'
    ? 'unread'
    : sight.fact?.state === 'untaken' || sight.fact?.state === 'previous'
      ? 'idle'
      : reading === 'pending'
        ? 'reading'
        : 'idle';
};

export const mainEntry = (root: ProjectRoot, sight: Sight, headTime: number | null, placings: readonly ThreadPlacing[]): Entry => {
  const read = fresh(sight);
  const agents = agentsOf(placings);
  const movedAt = latest(placings, headTime ?? 0);
  return {
    rank: 0,
    movedAt,
    row: {
      index: 0,
      missing: sight.gone || !sight.present,
      head: sight.metadata === undefined ? (sight.read?.head ?? null) : sight.metadata.head,
      headTime: sight.metadata?.headTime ?? null,
      stateFact: sight.fact ?? UNTAKEN,
      mergeFact: UNTAKEN,
      rootId: root.rootId,
      kind: 'main',
      name: MAIN,
      folder: root.path,
      branch: sight.metadata === undefined ? (sight.read?.ref ?? null) : sight.metadata.ref,
      base: null,
      hue: null,
      status: busy(agents) ?? rested(sight),
      check: 'unknown',
      agents,
      ahead: null,
      behind: null,
      uncommitted: read === null ? null : read.uncommitted,
      reading: readingOf(sight),
      diff: null,
      threads: active(placings),
      setup: 'none',
      taskId: null,
      pending: null,
      movedAt: movedAt === 0 ? null : new Date(movedAt).toISOString(),
    },
  };
};

export const externalEntry = (root: ProjectRoot, sight: Sight, placings: readonly ThreadPlacing[]): Entry => {
  const read = fresh(sight);
  const agents = agentsOf(placings);
  const status: WorktreeState = sight.present ? (busy(agents) ?? rested(sight)) : 'missing';
  const movedAt = latest(placings, 0);
  return {
    rank: RANKS[status] ?? 4,
    movedAt,
    row: {
      index: 0,
      missing: sight.gone || !sight.present,
      head: sight.metadata === undefined ? (sight.read?.head ?? null) : sight.metadata.head,
      headTime: sight.metadata?.headTime ?? null,
      stateFact: sight.fact ?? UNTAKEN,
      mergeFact: UNTAKEN,
      rootId: root.rootId,
      kind: 'external',
      name:
        root.path
          .split('/')
          .filter((part) => part !== '')
          .at(-1) ?? root.path,
      folder: root.path,
      branch: sight.metadata === undefined ? (sight.read?.ref ?? null) : sight.metadata.ref,
      base: null,
      hue: null,
      status,
      check: 'unknown',
      agents,
      ahead: null,
      behind: null,
      uncommitted: read === null ? null : read.uncommitted,
      reading: readingOf(sight),
      diff: null,
      threads: placings.map((one) => one.threadId).sort(),
      setup: 'none',
      taskId: null,
      pending: null,
      movedAt: movedAt === 0 ? null : new Date(movedAt).toISOString(),
    },
  };
};

export const recordedEntry = (
  record: WorktreeRecord,
  pending: PendingMerge | null,
  sight: Sight,
  distance: Distance | null,
  placings: readonly ThreadPlacing[],
): Entry => {
  const { gone } = sight;
  const read = fresh(sight);
  const head = read?.head ?? null;
  const measured = head === null ? null : distance;
  const ahead = measured?.ahead ?? null;
  const behind = measured?.behind ?? null;
  const check = measured?.check ?? 'unknown';
  const held = (measured?.held ?? false) && (ahead ?? 0) > 0;
  const uncommitted = read === null ? null : read.uncommitted;
  const agents = agentsOf(placings);
  const status: WorktreeState = gone
    ? 'missing'
    : check === 'conflicts'
      ? 'conflicts'
      : (busy(agents) ??
        (held && uncommitted === 0
          ? 'merged'
          : ahead !== null && ahead > 0 && uncommitted === 0
            ? 'ready'
            : ahead === 0 && uncommitted === 0 && head === record.baseCommit && behind !== null && behind > 0
              ? 'behind'
              : ahead === 0 && head !== null && head !== record.baseCommit
                ? 'merged'
                : rested(sight)));
  const movedAt = latest(placings, record.createdAt.getTime());
  return {
    rank: RANKS[status] ?? 4,
    movedAt,
    row: {
      index: 0,
      missing: sight.gone || !sight.present,
      head: sight.metadata === undefined ? (sight.read?.head ?? null) : sight.metadata.head,
      headTime: sight.metadata?.headTime ?? null,
      stateFact: sight.fact ?? UNTAKEN,
      mergeFact: measured?.fact ?? UNTAKEN,
      rootId: record.rootId,
      kind: 'tagma',
      name: record.name,
      folder: record.path,
      branch: sight.metadata === undefined ? (sight.read?.ref ?? record.branch) : sight.metadata.ref,
      base: { branch: record.baseBranch, commit: record.baseCommit },
      hue: record.hue,
      status,
      check,
      agents,
      ahead,
      behind,
      uncommitted,
      reading: readingOf(sight),
      diff: read?.diff ?? null,
      threads: placings.map((one) => one.threadId).sort(),
      setup: record.setup,
      taskId: record.taskId,
      pending,
      movedAt: new Date(movedAt).toISOString(),
    },
  };
};

export const listed = (main: Entry | null, others: readonly Entry[], placings: readonly ThreadPlacing[]): WorktreeEntries => {
  const sorted = [...others].sort(byKey);
  const shown = new Set<string>([...sorted.map((entry) => entry.row.rootId), ...(main === null ? [] : [main.row.rootId])]);
  const elsewhere = placings
    .flatMap((placing) => {
      const stray = strayOf(placing, (rootId) => shown.has(rootId));
      return stray === null ? [] : [stray];
    })
    .sort(byThread);
  return {
    entries: (main === null ? sorted : [main, ...sorted]).map((entry, index) => ({ ...entry, row: { ...entry.row, index } })),
    elsewhere,
  };
};
