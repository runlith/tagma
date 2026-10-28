import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { Clock, Effect } from 'effect';
import { logAt, unpushedAt } from '@runlith/git/history';
import { troubleOf } from '@runlith/git/repository';
import { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import type { FinishingPlace } from '../contract/wire/mergeTypes.js';
import { GateRefusal } from '../../platform/contract/wire/refusal.js';
import { inGraphTree } from '../../graph/contract/wire/storage.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { CleanedWorktree, CleanupBlocker, CleanupCandidate, CleanupReason } from '../contract/wire/cleanup.js';
import type { FinishRefusalRow } from '../contract/wire/failures.js';
import type { WorktreeRow } from '../contract/wire/rows.js';
import type { FinishFailure } from '../contract/wire/failures.js';
import { finishRefusalOf } from './finishing.js';
import { UNQUEUED, type ActProgress } from '../contract/service/progress.js';
import { type WorktreeRowRefusal, WorktreeRows } from '../contract/service/listing.js';
import { WorktreeCleanup } from '../contract/service/cleanup.js';
import { WorktreeRetirement } from '../contract/service/retirement.js';

const DAY_MS = 86_400_000;

const HEADS = 'refs/heads/';

const OWN_WORK = { excludeConfined: inGraphTree };

const NOT_A_CANDIDATE: FinishRefusalRow = {
  code: 'not-a-candidate',
  message: 'this worktree is not merged, missing or idle long enough to be cleaned up',
  unblock: ['list_worktree_cleanup — what can be cleaned up now', 'delete_worktree — delete this worktree on its own'],
};

const blocked = (message: string): FinishRefusalRow => ({
  code: 'blocked',
  message,
  unblock: [
    'end what holds it — stop the agent, commit or push the branch, drop the waiting merge — then clean up again',
    'delete_worktree — delete it on its own, which commits what it holds onto its branch',
  ],
});

const blockerWords: Record<CleanupBlocker['kind'], string> = {
  'agent-running': 'an agent runs there',
  uncommitted: 'it holds uncommitted paths',
  unpushed: 'its branch holds commits no remote and no base carries',
  unread: 'git could not say what its branch holds',
  'merge-waiting': 'a merge waits on it',
};

export const makeCleanupCandidates = Effect.fnUntraced(function* (input: {
  readonly place: (projectId: number, rootId: RootId) => Effect.Effect<FinishingPlace, FinishFailure>;
  readonly progress?: ActProgress;
}) {
  const { place, progress } = input;
  const { rows } = yield* WorktreeRows;
  const { delete: remove } = yield* WorktreeRetirement;
  const git = actingGit(yield* Git, 'worktree-cleanup');

  const committedAt = (row: WorktreeRow): Effect.Effect<number, GateRefusal<'worktree-unavailable'>> => {
    if (row.branch === null) return Effect.succeed(0);
    return logAt(git, row.folder, { range: `${HEADS}${row.branch}`, max: 1, ...OWN_WORK }).pipe(
      Effect.mapError(
        (failure) =>
          new GateRefusal('worktree-unavailable', `the last commit of ${row.name} could not be read: ${troubleOf(failure)}`, [
            'read this branch with git log and retry once the repository is readable',
          ]),
      ),
      Effect.flatMap((commits) => {
        if (commits[0] === undefined) return Effect.succeed(0);
        const at = Date.parse(commits[0].date);
        return Number.isFinite(at)
          ? Effect.succeed(at)
          : Effect.fail(
              new GateRefusal('worktree-unavailable', `the last commit of ${row.name} has no readable date`, [
                'inspect this branch with git log and repair its commit metadata before cleanup',
              ]),
            );
      }),
    );
  };

  const blockers = Effect.fnUntraced(function* (row: WorktreeRow): Effect.fn.Return<readonly CleanupBlocker[]> {
    const found: CleanupBlocker[] = [];
    const running = row.agents.working + row.agents.waiting;
    if (running > 0) found.push({ kind: 'agent-running', count: running });
    if (row.pending !== null) found.push({ kind: 'merge-waiting', count: 1 });
    if (row.status === 'missing') return found;
    const unread = row.reading !== 'done';
    if (unread) found.push({ kind: 'unread', count: 0 });
    if (row.uncommitted !== null && row.uncommitted > 0) found.push({ kind: 'uncommitted', count: row.uncommitted });
    if (row.branch !== null && row.status !== 'merged') {
      const tip = `${HEADS}${row.branch}`;
      const besides = row.base?.branch == null ? [] : [`${HEADS}${row.base.branch}`];
      const counted = yield* Effect.result(
        unpushedAt(git, row.folder, tip, besides, OWN_WORK).pipe(
          Effect.catch((failure) => (besides.length === 0 ? Effect.fail(failure) : unpushedAt(git, row.folder, tip, [], OWN_WORK))),
        ),
      );
      if (counted._tag === 'Failure') {
        yield* Effect.logWarning('the unpushed commits of a worktree could not be counted', {
          rootId: row.rootId,
          reason: troubleOf(counted.failure),
        });
        if (!unread) found.push({ kind: 'unread', count: 0 });
      } else if (counted.success > 0) {
        found.push({ kind: 'unpushed', count: counted.success });
      }
    }
    return found;
  });

  const candidate = Effect.fnUntraced(function* (row: WorktreeRow, now: number, idleAfterDays: number) {
    const committed = row.status === 'missing' ? 0 : yield* committedAt(row);
    const moved = Math.max(row.movedAt === null ? 0 : Date.parse(row.movedAt), committed);
    const idleDays = Math.max(0, Math.floor((now - moved) / DAY_MS));
    const reason: CleanupReason | null =
      row.status === 'missing' ? 'missing' : row.status === 'merged' ? 'merged' : idleDays >= idleAfterDays ? 'idle' : null;
    if (reason === null) return null;
    return {
      rootId: row.rootId,
      name: row.name,
      folder: row.folder,
      branch: row.branch,
      hue: row.hue,
      reason,
      idleDays,
      blockers: yield* blockers(row),
    } satisfies CleanupCandidate;
  });

  const candidates = Effect.fn('WorktreeCleanup.candidates')(function* (
    projectId: number,
    idleAfterDays: number,
  ): Effect.fn.Return<readonly CleanupCandidate[], GateRefusal<WorktreeRowRefusal>> {
    const listed = yield* rows(projectId);
    const now = yield* Clock.currentTimeMillis;
    const found = yield* Effect.forEach(
      listed.filter((row) => row.kind === 'tagma'),
      (row) => candidate(row, now, idleAfterDays),
      { concurrency: 3 },
    );
    return found.filter((one): one is CleanupCandidate => one !== null);
  });

  const cleaned = Effect.fnUntraced(function* (
    projectId: number,
    rootId: RootId,
    standing: CleanupCandidate | undefined,
    end: TerminalActor | undefined,
  ): Effect.fn.Return<CleanedWorktree> {
    if (standing === undefined) return { rootId, name: null, outcome: 'refused', refusal: NOT_A_CANDIDATE, ended: [] };
    if (standing.blockers.length > 0) {
      return {
        rootId,
        name: standing.name,
        outcome: 'refused',
        refusal: blocked(standing.blockers.map((one) => blockerWords[one.kind]).join('; ')),
        ended: [],
      };
    }
    const deleted = yield* Effect.result(remove(projectId, rootId, end));
    return deleted._tag === 'Success'
      ? {
          rootId,
          name: standing.name,
          outcome: deleted.success.branch.status === 'deleted' ? 'deleted' : 'branch-kept',
          refusal: null,
          ended: deleted.success.ended,
        }
      : { rootId, name: standing.name, outcome: 'refused', refusal: finishRefusalOf(deleted.failure), ended: [] };
  });

  return WorktreeCleanup.of({
    places: (projectId, rootIds) => Effect.forEach(rootIds, (rootId) => place(projectId, rootId)),
    candidates,
    clean: Effect.fn('WorktreeCleanup.clean')(function* (projectId, rootIds, idleAfterDays, end) {
      const ordered = [...new Set(rootIds)];
      const work = Effect.scoped(
        Effect.gen(function* () {
          const standing = new Map((yield* candidates(projectId, idleAfterDays)).map((one) => [one.rootId as string, one]));
          const turns = progress === undefined ? UNQUEUED : yield* progress.queue(projectId, ordered, 'clean');
          const done: CleanedWorktree[] = [];
          for (const rootId of ordered) done.push(yield* turns.take(rootId, cleaned(projectId, rootId, standing.get(rootId), end)));
          return done;
        }),
      );
      return yield* progress === undefined ? work : progress.detached(work);
    }),
  });
});
