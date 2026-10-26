import { Cause, Effect } from 'effect';
import { TwinFailed } from '../../graph/contract/service/branchTwins.js';
import { BranchRefs, type BranchRefFailure } from '../contract/service/refs.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { worktree } from '../store/tables.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { branchSlug, PROVISIONAL_NAME } from '../contract/wire/creation.js';
import type { WorktreeFinishRefused } from '../contract/wire/failures.js';
import { BranchTwinning } from '../contract/service/branches.js';
import { WorktreeThreads } from '../contract/service/finishingGate.js';
import { FinishingGate } from '../contract/service/retirement.js';
import { type WorktreeRecord, WorktreeRecords } from '../contract/service/worktrees.js';

const PROVISIONAL = new RegExp(`^(.*)${PROVISIONAL_NAME}-([0-9a-f]{6})$`);

export type BranchTitled =
  | { readonly status: 'renamed'; readonly rootId: RootId; readonly from: string; readonly to: string }
  | { readonly status: 'kept'; readonly rootId: RootId; readonly branch: string | null; readonly reason: string };

const HEADS = 'refs/heads/';

export type ProvisionalBranches = {
  readonly onRenamed: (listener: (projectId: number) => void) => () => void;
  readonly titled: (threadId: string, title: string) => Effect.Effect<BranchTitled | null>;
  readonly move: (record: WorktreeRecord, from: string, to: string, threadId?: string) => Effect.Effect<boolean, TwinFailed | StoreFailure>;
};

export const makeProvisionalBranches = Effect.gen(function* () {
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const refs = yield* BranchRefs;
  const { twins } = yield* BranchTwinning;
  const { standingRoot: standing } = yield* WorktreeThreads;
  const gates = yield* FinishingGate;
  const gate = <A, E>(rootId: RootId, work: Effect.Effect<A, E>) => gates.hold({ kind: 'root', rootId }, work);
  const told = new Set<(projectId: number) => void>();

  const announce = (projectId: number): void => {
    for (const listener of told) listener(projectId);
  };

  const renaming = (path: string, from: string, to: string): Effect.Effect<void, TwinFailed> =>
    Effect.mapError(refs.rename(path, from, to), (failure) => new TwinFailed({ message: failure.message }));

  const recorded = (record: WorktreeRecord, threadId: string, from: string, to: string): Effect.Effect<BranchTitled | null, StoreFailure> =>
    Effect.map(
      units.write(writes('ProvisionalBranches.recorded', [worktree]), (unit) => records.renamed(record.rootId, from, to, unit, threadId)),
      (moved) => {
        if (!moved) return null;
        announce(record.projectId);
        return { status: 'renamed' as const, rootId: record.rootId, from, to };
      },
    );

  const kept = (record: WorktreeRecord, threadId: string, reason: string): Effect.Effect<BranchTitled, StoreFailure> =>
    Effect.as(
      units.write(writes('ProvisionalBranches.kept', [worktree]), (unit) => records.unnamed(record.rootId, threadId, unit)),
      {
        status: 'kept' as const,
        rootId: record.rootId,
        branch: record.branch,
        reason,
      },
    );

  const move = Effect.fn('ProvisionalBranches.move')(function* (
    record: WorktreeRecord,
    from: string,
    to: string,
    threadId?: string,
  ): Effect.fn.Return<boolean, TwinFailed | StoreFailure> {
    const place = { projectId: record.projectId, checkout: record.path, from, to };
    yield* twins(place, renaming(record.path, from, to));
    const written = yield* Effect.result(
      units.write(writes('ProvisionalBranches.written', [worktree]), (unit) => records.renamed(record.rootId, from, to, unit, threadId)),
    );
    if (written._tag === 'Success' && written.success) {
      announce(record.projectId);
      return true;
    }
    const back = yield* Effect.result(twins({ ...place, from: to, to: from }, renaming(record.path, to, from)));
    if (back._tag === 'Failure') {
      yield* Effect.logWarning('a renamed worktree branch whose record could not follow was not renamed back', {
        rootId: record.rootId,
        from: to,
        to: from,
        reason: back.failure.message,
      });
    }
    return written._tag === 'Failure' ? yield* Effect.fail(written.failure) : false;
  });

  const settle = Effect.fn('ProvisionalBranches.settle')(function* (
    threadId: string,
    rootId: RootId,
    from: string,
    to: string,
  ): Effect.fn.Return<BranchTitled | null, StoreFailure | TwinFailed> {
    const record = yield* units.read((unit) => records.namedAfter(threadId, unit));
    if (record === null || record.rootId !== rootId || record.branch !== from) return null;
    const keep = (reason: string) => kept(record, threadId, reason);
    const read = <A>(reading: Effect.Effect<A, BranchRefFailure>) => Effect.result(Effect.mapError(reading, (failure) => failure.message));
    const head = yield* read(refs.head(record.path));
    if (head._tag === 'Failure') return yield* keep(`git could not read the worktree: ${head.failure}`);
    if (head.success.ref === `${HEADS}${to}`) {
      yield* twins({ projectId: record.projectId, checkout: record.path, from, to }, Effect.void);
      return yield* recorded(record, threadId, from, to);
    }
    if (head.success.ref !== `${HEADS}${from}`) return yield* keep(`the worktree no longer stands on ${from}`);
    const pushed = yield* read(refs.published(record.path, from));
    if (pushed._tag === 'Failure') return yield* keep(`git could not say whether ${from} was pushed: ${pushed.failure}`);
    if (pushed.success) return yield* keep(`${from} was pushed, and a remote knows it by that name`);
    const taken = yield* read(refs.commit(record.path, `${HEADS}${to}`));
    if (taken._tag === 'Failure') return yield* keep(`git could not read ${to}: ${taken.failure}`);
    if (taken.success !== null) return yield* keep(`${to} already names a branch`);
    const renamed = yield* Effect.result(move(record, from, to, threadId));
    if (renamed._tag === 'Failure') {
      return renamed.failure._tag === 'TwinFailed' ? yield* keep(renamed.failure.message) : yield* Effect.fail(renamed.failure);
    }
    return renamed.success ? { status: 'renamed' as const, rootId, from, to } : null;
  });

  const naming = Effect.fn('ProvisionalBranches.naming')(function* (
    threadId: string,
    title: string,
  ): Effect.fn.Return<BranchTitled | null, StoreFailure | TwinFailed | WorktreeFinishRefused> {
    const record = yield* units.read((unit) => records.namedAfter(threadId, unit));
    if (record === null) return null;
    const stood = yield* Effect.result(standing(threadId));
    if (stood._tag === 'Failure')
      return yield* kept(record, threadId, `where the thread stands could not be read: ${stood.failure.message}`);
    if (stood.success !== record.rootId) return yield* kept(record, threadId, 'the thread no longer stands in this worktree');
    const from = record.branch;
    const parsed = from === null ? null : PROVISIONAL.exec(from);
    if (from === null || parsed === null) return yield* kept(record, threadId, 'the branch does not carry a provisional name');
    const slug = branchSlug(title);
    if (slug === '' || slug === PROVISIONAL_NAME) return yield* kept(record, threadId, 'the title spells no branch name');
    const to = `${parsed[1]}${slug}-${parsed[2]}`;
    return yield* gate(record.rootId, Effect.uninterruptible(settle(threadId, record.rootId, from, to)));
  });

  const branches: ProvisionalBranches = {
    onRenamed: (listener) => {
      told.add(listener);
      return () => {
        told.delete(listener);
      };
    },
    titled: (threadId, title) =>
      naming(threadId, title).pipe(
        Effect.tap((outcome) =>
          outcome?.status === 'kept'
            ? Effect.logInfo('a provisional worktree branch kept its name', { threadId, ...outcome })
            : Effect.void,
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning('a provisional worktree branch was not renamed', { threadId, reason: Cause.squash(cause) }).pipe(
            Effect.as(null),
          ),
        ),
      ),
    move,
  };
  return branches;
});
