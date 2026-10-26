import { Effect, type Context } from 'effect';
import { ancestorAt, commitsAt, type Commit } from '@runlith/git/history';
import { commitOf } from '@runlith/git/repository';
import type { Git } from '@runlith/git/Git';
import type { MachineStore } from '../../platform/contract/service/store.js';
import type { MachineUnits } from '../../platform/contract/service/units.js';
import { actingGit } from '../../platform/git/ownGit.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { ChangeCommit } from '../contract/wire/threadChanges.js';
import { commitsOfThread, type StampedCommit } from '../record/reads.js';
import { outcomesOf } from '../record/outcomes.js';
import type { CheckoutPaths } from '../../workspace/contract/service/checkoutPaths.js';
import type { KnownOutcomes } from '../contract/service/record.js';

export const COMMIT_RECORD = 1024;

const COMMITS_KEPT = 2_000;

const REACHING = 4;

const DESCRIBED_RECORD = 65_536;

export type CommitReaders = {
  readonly store: Context.Service.Shape<typeof MachineStore>;
  readonly units: MachineUnits['Service'];
  readonly git: Git['Service'];
  readonly paths: CheckoutPaths['Service'];
};

export type Reaching = { readonly head: string; readonly reached: Map<string, boolean> };

export type CommitsKept = {
  readonly described: Map<string, Commit>;
  readonly reaching: Map<string, Reaching>;
};

export type Listed = {
  readonly rootId: RootId;
  readonly placed: number | null;
  readonly projectId: number;
  readonly threadId: string;
  readonly limit: number;
  readonly dir: string;
};

export type ReadCommits = {
  readonly outcomes: KnownOutcomes;
  readonly commits: readonly ChangeCommit[];
  readonly more: boolean;
  readonly partial: boolean;
};

type Described = { readonly known: ReadonlyMap<string, Commit>; readonly unread: string | null };

type Unread = { readonly _tag: 'unread'; readonly cause: string };

export const commitsOf = Effect.fn('ThreadFiles.commits')(function* (readers: CommitReaders, kept: CommitsKept, state: Listed) {
  const outcome = yield* outcomesOf(
    readers.units,
    readers.store,
    readers.git,
    readers.paths,
    state.projectId,
    state.threadId,
    state.rootId,
  );
  const outcomes = outcome.known;
  const windowOf = (from: number, count: number) =>
    commitsOfThread(readers.units, readers.store, state.projectId, state.threadId, state.rootId, { from, count }, outcome);
  const limit = state.limit;
  const opening = yield* windowOf(0, limit + 1);
  if (opening.length === 0) return { outcomes, commits: [], more: false, partial: outcomes.unread.length > 0 };
  const head = yield* Effect.result(
    commitOf(actingGit(readers.git, 'thread-files-commits'), state.dir, 'HEAD', { capture: COMMIT_RECORD }),
  );
  if (head._tag === 'Failure') {
    yield* Effect.logWarning('the commits of a thread are not listed: HEAD of its checkout could not be read', {
      dir: state.dir,
      reason: head.failure.message,
    });
    return {
      outcomes: { commits: [], unread: [{ checkout: state.rootId, reason: head.failure.message }] },
      commits: [],
      more: false,
      partial: true,
    };
  }
  const tip = head.success;
  if (tip === null) return { outcomes, commits: [], more: false, partial: false };
  const reached = reachedAt(kept, state.dir, tip);
  const listed: ChangeCommit[] = [];
  const unread = new Set<string>();
  let window = opening;
  for (let from = opening.length; window.length > 0 && listed.length <= limit;) {
    const described = yield* describe(readers.git, kept, state.dir, window);
    if (described.unread !== null) unread.add(described.unread);
    const decided = yield* Effect.forEach(
      window,
      (one) => placed(readers.git, kept, state.dir, tip, reached, one, described, state.rootId, state.placed),
      {
        concurrency: REACHING,
      },
    );
    for (const one of decided) {
      if (one !== null && 'cause' in one) unread.add(one.cause);
      else if (one !== null && listed.length <= limit) listed.push(one);
    }
    if (listed.length > limit) break;
    window = yield* windowOf(from, Math.max(REACHING, limit + 1 - listed.length));
    from += window.length;
  }
  if (unread.size > 0)
    yield* Effect.logWarning('the commits of a thread are listed in part: git could not describe some of them', {
      dir: state.dir,
      reasons: [...unread],
    });
  return { outcomes, commits: listed.slice(0, limit), more: listed.length > limit, partial: unread.size + outcomes.unread.length > 0 };
});

const placed = Effect.fnUntraced(function* (
  git: Git['Service'],
  kept: CommitsKept,
  dir: string,
  head: string,
  reached: Map<string, boolean>,
  one: StampedCommit,
  described: Described,
  checkout: RootId,
  projectId: number | null,
): Effect.fn.Return<ChangeCommit | Unread | null> {
  const commit = described.known.get(one.commit);
  if (commit === undefined) return described.unread === null ? null : { _tag: 'unread', cause: described.unread };
  const standing = reached.get(one.commit);
  const reaches =
    standing ?? (yield* Effect.result(ancestorAt(actingGit(git, 'thread-files-reach'), dir, one.commit, head, { capture: COMMIT_RECORD })));
  if (typeof reaches !== 'boolean' && reaches._tag === 'Failure') {
    const held = yield* Effect.result(commitsAt(actingGit(git, 'thread-files-held'), dir, [one.commit]));
    if (held._tag === 'Failure') return { _tag: 'unread', cause: held.failure.message };
    if (held.success.has(one.commit)) return { _tag: 'unread', cause: reaches.failure.message };
    kept.described.delete(one.commit);
    return null;
  }
  const on = typeof reaches === 'boolean' ? reaches : reaches.success;
  reached.set(one.commit, on);
  if (!on) return null;
  return { checkout, projectId, sha: commit.sha, subject: commit.subject, author: commit.author, date: commit.date, files: one.files };
});

const describe = Effect.fnUntraced(function* (
  git: Git['Service'],
  kept: CommitsKept,
  dir: string,
  window: readonly StampedCommit[],
): Effect.fn.Return<Described> {
  const known = new Map<string, Commit>();
  const unknown: string[] = [];
  for (const one of window) {
    const held = kept.described.get(one.commit);
    if (held === undefined) unknown.push(one.commit);
    else known.set(one.commit, held);
  }
  if (unknown.length === 0) return { known, unread: null };
  const read = yield* Effect.result(
    commitsAt(actingGit(git, 'thread-files-described'), dir, unknown, {
      capture: unknown.length * DESCRIBED_RECORD,
    }),
  );
  if (read._tag === 'Failure') return { known, unread: read.failure.message };
  for (const [sha, commit] of read.success) {
    known.set(sha, commit);
    kept.described.set(sha, commit);
    for (const oldest of kept.described.keys()) {
      if (kept.described.size <= COMMITS_KEPT) break;
      kept.described.delete(oldest);
    }
  }
  return { known, unread: null };
});

function reachedAt(kept: CommitsKept, dir: string, head: string): Map<string, boolean> {
  const standing = kept.reaching.get(dir);
  if (standing !== undefined && standing.head === head) return standing.reached;
  const fresh = { head, reached: new Map<string, boolean>() };
  kept.reaching.set(dir, fresh);
  return fresh.reached;
}
