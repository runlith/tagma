import { closeSync, openSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import * as BunFileSystem from '@effect/platform-bun/BunFileSystem';
import { Context, Effect, Exit } from 'effect';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { lockExclusive } from '@runlith/file-lock/flock';
import type {
  PrepareInput,
  PreparedChange,
  PreparedChanges,
  PreparedFns,
  PreparedOutcome,
  PreparedPlace,
  PreparedReads,
  PreparedRefusal,
  PreparedRow,
  TeamMember,
} from '../contract/service/prepared.js';
import type { CommitShape } from '../contract/service/shape.js';
import { changedAmong, recordedPaths, selectedPaths } from './team.js';
import { closed } from './closure.js';
import { build, type Landing, WEIGHED_BYTES } from './tree.js';
import { rebasePrepared } from './rebase.js';
import { shapeBuilt } from './shaped.js';
import { operationIn } from '../../platform/git/places.js';
import { commitsOfHolders } from '../record/reads.js';
import {
  besideMerge,
  kindOfPreparedEntry,
  locateIndex,
  mergeFor,
  onBranch,
  preparedBase,
  releaseIndex,
  subjectOf,
  sweepClaim,
  sweepInstance,
  type InstanceLock,
} from './subject.js';
import type { OwnGitFailed } from '../../platform/git/ownGit.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';

type StoreShape = Context.Service.Shape<typeof MachineStore>;

const SNAPSHOTS = 3;

export const prepareChange = Effect.fn('prepared.prepare')(function* <Row extends PreparedRow, Caller>(
  reads: PreparedReads<Row>,
  fns: PreparedFns,
  instanceDir: string,
  shape: CommitShape['Service'],
  args: PrepareInput<Caller>,
): Effect.fn.Return<PreparedOutcome<Caller>, OwnGitFailed | GateRefusal<PreparedRefusal> | StoreFailure> {
  const { projectId, git, root, store, units, origin, checkout, input, job, caller, act } = args;
  if (origin.work === null && (input.paths ?? []).length === 0 && input.everything !== true)
    return yield* new GateRefusal(
      'no-record',
      'this caller writes through tools the change record does not see, so the record names no files of its own to land',
      ['name the paths: every changed file under them lands as it stands'],
    );
  const { places, ref, commit: head } = yield* onBranch(git, root);
  const team = origin.work === null ? [] : yield* reads.team(units, store, origin.work);
  const decided = Effect.map(
    Effect.forEach(team, ({ projectId, threadId }) =>
      projectId === null ? Effect.succeed(0) : reads.commands.decided({ projectId, threadId }),
    ),
    (revisions) => revisions.join(','),
  );
  const place = { git, root, store, units, checkout, head };
  const select = () => selectedPaths(place, reads, fns, input, team);
  let seen = yield* decided;
  let selection = yield* select();
  for (let snapshot = 1; ; snapshot += 1) {
    yield* reads.commands.settled({ checkout, paths: selection.paths });
    const now = yield* decided;
    if (now === seen || snapshot >= SNAPSHOTS) break;
    seen = now;
    selection = yield* select();
  }
  const nothing = { prepared: null, emptied: null, team, unmatched: [...selection.unmatched], paths: [], unattributed: [] };
  if (selection.paths.length === 0) return nothing;
  const open = yield* operationIn(places);
  const prepared = yield* Effect.acquireUseRelease(
    locateIndex(instanceDir),
    (index) =>
      Effect.gen(function* () {
        const landing: Landing<Row> = {
          projectId,
          git,
          root,
          store,
          units,
          reads,
          fns,
          origin,
          act,
          checkout,
          input,
          team,
          selection,
          index,
          gitDir: places.gitDir,
          commonDir: places.commonDir,
          job,
        };
        const carried = yield* closed(landing, head, selection, WEIGHED_BYTES).pipe(Effect.provide(BunFileSystem.layer));
        const beside = yield* besideMerge(git, root, carried.paths, open);
        const merge = beside ? undefined : yield* mergeFor(git, root, places, open);
        const built = yield* build(landing, carried, head, merge);
        const paths = built.plan.map((one) => one.path);
        const { unattributed } = built;
        if (built.changed.length === 0 && merge === undefined) {
          yield* releaseIndex(index);
          return { _tag: 'idle', paths, unattributed } as const;
        }
        const shaping = yield* shapeBuilt(landing, built, shape, merge !== undefined);
        if (shaping._tag === 'emptied') {
          yield* releaseIndex(index);
          return { ...shaping, paths, unattributed };
        }
        const finished = shaping.finished;
        return {
          _tag: 'shaped',
          paths,
          unattributed,
          prepared: {
            subject: yield* subjectOf(landing, finished, caller, merge),
            built: {
              base: finished.base,
              tree: finished.tree,
              from: finished.from,
              changed: finished.changed,
              entries: finished.entries,
              plan: finished.plan.map((one) => ({ path: one.path, writers: one.writers, ids: one.ids })),
              hashes: finished.hashes,
              reshaped: finished.reshaped,
              formatSkipped: finished.formatSkipped,
              declaration: finished.declaration,
              derived: finished.derived,
            },
            index,
            places,
            ref,
            merge,
            beside: beside ? 'merge' : undefined,
          },
        } as const;
      }),
    (index, exit) => (Exit.isSuccess(exit) ? Effect.void : releaseIndex(index)),
  );
  return {
    ...nothing,
    prepared: prepared._tag === 'shaped' ? prepared.prepared : null,
    emptied: prepared._tag === 'emptied' ? prepared.emptied : null,
    paths: prepared.paths,
    unattributed: prepared.unattributed,
  };
});

export const releasePrepared = (prepared: PreparedChange<unknown>): Effect.Effect<void> => releaseIndex(prepared.index);

const attemptLock = (fd: number): InstanceLock | null => {
  try {
    return lockExclusive(fd) === 'locked' ? 'locked' : 'held';
  } catch {
    return null;
  }
};

const sweepInstanceDir = (dir: string, staging: boolean): void => {
  let lock: InstanceLock = 'missing';
  let fd: number | null = null;
  try {
    fd = openSync(join(dir, 'lock'), 'r');
  } catch {
    fd = null;
  }
  if (fd !== null) {
    const got = attemptLock(fd);
    try {
      closeSync(fd);
    } catch {
      return;
    }
    if (got === null) return;
    lock = got;
  }
  if (staging) {
    if (!sweepClaim(lock)) return;
  } else {
    let empty: boolean;
    try {
      empty = readdirSync(dir).length === 0;
    } catch {
      return;
    }
    if (!sweepInstance(lock, empty)) return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    return;
  }
};

export const sweepPreparedIndexes = (store: StoreShape): Effect.Effect<void> =>
  Effect.sync(() => {
    const base = preparedBase(store);
    let entries: readonly Dirent[];
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const kind = kindOfPreparedEntry(entry.name);
      if (kind === 'foreign') continue;
      sweepInstanceDir(join(base, entry.name), kind === 'claim');
    }
  });

const CARRIED_BY = 20;

const remaining = <Row extends PreparedRow>(reads: PreparedReads<Row>, fns: PreparedFns) =>
  Effect.fn('prepared.remaining')(function* (place: PreparedPlace, team: readonly TeamMember[]) {
    if (team.length === 0) return [];
    return yield* changedAmong(place, fns, yield* recordedPaths({ ...place, head: null }, reads, team));
  });

export const makePreparedChanges = <Row extends PreparedRow>(
  reads: PreparedReads<Row>,
  fns: PreparedFns,
  instanceDir: string,
  shape: CommitShape['Service'],
): Context.Service.Shape<typeof PreparedChanges> => ({
  prepare: <Caller>(args: PrepareInput<Caller>) => prepareChange(reads, fns, instanceDir, shape, args),
  rebase: (git, root, prepared, head) => rebasePrepared(git, root, prepared, head),
  release: (prepared) => releasePrepared(prepared),
  remaining: remaining(reads, fns),
  teamCheckouts: Effect.fn('prepared.teamCheckouts')(function* (units, store, work) {
    const team = yield* reads.team(units, store, work);
    const held = yield* reads.heldCheckouts(
      units,
      store,
      team.map((one) => one.threadId),
    );
    const observed = team.flatMap(({ projectId, threadId }) =>
      projectId === null ? [] : reads.commands.unattributed({ projectId, threadId }).map((one) => one.checkout),
    );
    return { team, checkouts: [...new Set([...held, ...observed])] };
  }),
  carriedBy: (place, team) =>
    commitsOfHolders(
      place.units,
      place.store,
      place.checkout,
      team.map((one) => one.threadId),
      CARRIED_BY,
    ),
});
