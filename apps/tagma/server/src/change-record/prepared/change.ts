import { closeSync, openSync, readdirSync, rmSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Exit } from 'effect';
import type { MachineStore, StoreFailure } from '../../platform/contract/service/store.js';
import { lockExclusive } from '@runlith/file-lock/flock';
import type {
  ChangeInput,
  PrepareInput,
  PreparedChange,
  PreparedChanges,
  PreparedFns,
  PreparedOutcome,
  PreparedReads,
  PreparedRefusal,
  PreparedRow,
} from '../contract/service/prepared.js';
import type { CarrierAdmission } from '../contract/service/carriers.js';
import type { CommitShape } from '../contract/service/shape.js';
import { carriersOf, heldPaths } from './carriers.js';
import { build, type Landing } from './tree.js';
import { rebasePrepared } from './rebase.js';
import { shapeBuilt } from './shaped.js';
import { operationIn } from '../../platform/git/places.js';
import {
  kindOfPreparedEntry,
  locateIndex,
  mergeFor,
  onBranch,
  peerMerge,
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
  if (origin.work === null && (input.paths ?? []).length === 0 && input.taking.length === 0)
    return yield* new GateRefusal(
      'no-record',
      'this caller writes through tools the change record does not see, so it holds no lines to land',
      ['name the paths: their lines nobody holds are this change, and independent lines of other sessions stay out'],
    );
  const { places, ref, commit: head } = yield* onBranch(git, root);
  const sessions = carriersOf(origin, input);
  const carriers = new Set(sessions.map((session) => session.threadId));
  const decided = Effect.map(
    Effect.forEach(sessions, ({ projectId, threadId }) =>
      projectId === null ? Effect.succeed(0) : reads.commands.decided({ projectId, threadId }),
    ),
    (revisions) => revisions.join(','),
  );
  const select = () => heldPaths(git, root, store, units, reads, fns, checkout, head, input, sessions, origin.work?.threadId ?? null);
  let seen = yield* decided;
  let selection = yield* select();
  for (let snapshot = 1; ; snapshot += 1) {
    yield* reads.commands.settled({ checkout, paths: selection.paths });
    const now = yield* decided;
    if (now === seen || snapshot >= SNAPSHOTS) break;
    seen = now;
    selection = yield* select();
  }
  const { paths, unmatched, unattributed, pairs } = selection;
  const open = yield* operationIn(places);
  const beside = yield* peerMerge(fns, { git, root, store, units, checkout }, carriers, paths, open);
  const merge = beside ? undefined : yield* mergeFor(git, root, places, open);
  if (paths.length === 0 && merge === undefined)
    return { prepared: null, emptied: null, unmatched: [...unmatched], paths: [], unattributed: [...unattributed] };
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
          carriers,
          paths,
          explicit: selection.explicit,
          team: selection.team,
          pairs,
          message: '',
          index,
          gitDir: places.gitDir,
          commonDir: places.commonDir,
          job,
        };
        const built = yield* build(landing, head, merge);
        if (built.changed.length === 0 && merge === undefined) {
          yield* releaseIndex(index);
          return { _tag: 'idle' } as const;
        }
        const shaping = yield* shapeBuilt(landing, built, shape, merge !== undefined);
        if (shaping._tag === 'emptied') {
          yield* releaseIndex(index);
          return shaping;
        }
        const finished = shaping.finished;
        return {
          _tag: 'shaped',
          prepared: {
            subject: yield* subjectOf(landing, finished, caller, merge),
            built: {
              base: finished.base,
              tree: finished.tree,
              from: finished.from,
              changed: finished.changed,
              entries: finished.entries,
              plan: finished.plan.map((one) =>
                one.land === 'own'
                  ? { path: one.path, land: 'own' as const, landed: one.landed, holders: one.holders, ids: one.ids }
                  : { path: one.path, land: 'whole' as const, holders: one.holders, ids: one.ids },
              ),
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
    prepared: prepared._tag === 'shaped' ? prepared.prepared : null,
    emptied: prepared._tag === 'emptied' ? prepared.emptied : null,
    unmatched: [...unmatched],
    paths: [...paths],
    unattributed: [...unattributed],
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

export const makePreparedChanges = <Row extends PreparedRow>(
  reads: PreparedReads<Row>,
  admission: CarrierAdmission['Service'],
  fns: PreparedFns,
  instanceDir: string,
  shape: CommitShape['Service'],
): Context.Service.Shape<typeof PreparedChanges> => ({
  prepare: <Caller>(args: PrepareInput<Caller>) => prepareChange(reads, fns, instanceDir, shape, args),
  rebase: (git, root, prepared, head) => rebasePrepared(git, root, prepared, head),
  lease: (input: ChangeInput) => admission.admit(input.taking.map((session) => session.threadId)),
  release: (prepared) => releasePrepared(prepared),
});
