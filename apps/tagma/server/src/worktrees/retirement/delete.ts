import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Clock, Effect, FileSystem } from 'effect';
import { eq } from 'drizzle-orm';
import { MachineStore } from '../../platform/contract/service/store.js';
import { uuidv7 } from 'uuidv7';
import { removeWorktreeAt, worktreesOf } from '@runlith/git/worktree';
import { commitOf, headAt, locationsAt } from '@runlith/git/repository';
import { stagedEntriesAt } from '@runlith/git/entries';
import { Git } from '@runlith/git/Git';
import { STOP_LADDER_MS } from '@runlith/executions/protocol/call';
import type { PreparedChange } from '../../change-record/contract/service/prepared.js';
import { actingGit, runGit, type OwnGitFailed } from '../../platform/git/ownGit.js';
import { withholding } from '../../platform/watch/tree.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { writes } from '../../platform/contract/service/writes.js';
import { RequestKey } from '../../platform/contract/wire/ids.js';
import { fileRoot, fileRootNamespace, projectRoot } from '../../workspace/store/tables.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { CommitTrees } from '../../workspace/contract/service/commitTrees.js';
import { Retirement } from '../../change-record/contract/service/retirement.js';
import { FileRoots, RootUses } from '../../workspace/contract/service/roots.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { RootUse } from '../../workspace/contract/wire/uses.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import type { RootExecution, Unreachable } from '../../executions/contract/service/rootExecutions.js';
import type { EndedExecution } from '../../executions/contract/wire/rootExecutions.js';
import type { WorktreeDeleted } from '../contract/wire/retirement.js';
import { worktree, worktreeState } from '../store/tables.js';
import type { ActProgress } from '../contract/service/progress.js';
import type { MergeChecks } from '../contract/service/mergeChecks.js';
import { PreservationCommit, type PreservationFailure, type PreservedWorktree } from '../contract/service/preservation.js';
import { FinishingGate, GraphDelivering, RetirementSettlement, WorktreeDeparture } from '../contract/service/retirement.js';
import { RootEndings } from '../contract/service/rootEndings.js';
import { type WorktreeRecord, WorktreeRecords } from '../contract/service/worktrees.js';
import { WorktreeFinishRefused, WorktreeUnavailable, type FinishFailure } from '../contract/wire/failures.js';
import { DeletionUnreadable, type DeletionIntent, makeDeletionIntents } from '../store/deletions.js';
import type { BranchDeletion } from './branch.js';
import { worktreeDeletion, type DeletionPhase } from '../store/tables.js';
import { asked, finishNotAdmitted, holderName, leftBehind, pathsOf, refused, still, stored } from './finishing.js';
import { type FinishingGuards, UNCOMMITTED, WorktreeThreads } from '../contract/service/finishingGate.js';

const WATCHER_ROUND_MS = 1_000;

const ENDING_WAIT_MS = STOP_LADDER_MS + WATCHER_ROUND_MS;

const ENDING_POLL = '250 millis';

const OPEN_PAGE = 64;

const deletionIndexName = (key: RequestKey): string =>
  `tagma-deletion-${createHash('sha256').update(key).digest('hex').slice(0, 24)}.index`;

const holderWords = (holder: string): string =>
  holder === 'operator' ? 'the operator' : holder.startsWith('thread:') ? `thread ${holder.slice('thread:'.length)}` : holder;

const useWords = (use: RootUse): string => `${use.consumer.kind} ${use.consumer.id}`;

const executionWords = (standing: RootExecution): string =>
  standing.shown === null
    ? useWords(standing.use)
    : `${standing.shown.kind} ${standing.shown.execution.execution} (${standing.shown.program ?? 'unknown program'}) held by ${holderWords(standing.shown.holder)}`;

const UNREACHABLE: Record<Unreachable, string> = {
  unknown: 'no terminal or command of this project answers for it',
  'stop-refused': 'its stop was refused',
  'started-elsewhere': 'it was started outside this worktree, so no finishing dialog lists it',
};

type Ending = { readonly ended: readonly EndedExecution[]; readonly known: ReadonlyMap<string, string> };

type Committed = WorktreeDeleted['committed'];

type Leftovers = { readonly paths: readonly string[]; readonly untracked: readonly string[] };

type Retired = { readonly branch: WorktreeDeleted['branch']; readonly threads: WorktreeDeleted['threads'] };

const NOTHING_ENDED: Ending = { ended: [], known: new Map() };

const intending = writes('worktrees.deletion.intend', [worktreeDeletion]);

const entering = writes('worktrees.deletion.enter', [worktreeDeletion]);

const closing = writes('worktrees.deletion.close', [worktreeDeletion]);

const preservationRefusal = (failure: PreservationFailure): WorktreeFinishRefused => {
  if (failure._tag === 'PreservationRefused' && failure.reason === 'unsigned') {
    return new WorktreeFinishRefused({
      reason: 'commit-unsigned',
      message: failure.message,
      unblock: ['answer the signer commit.gpgsign names, or set gpg.format and user.signingkey so git can sign, then delete it again'],
    });
  }
  if (failure._tag === 'PreservationRefused') {
    return new WorktreeFinishRefused({
      reason: failure.reason === 'mid-operation' ? 'operation-in-progress' : failure.reason === 'no-base' ? 'no-branch' : 'git-refused',
      message: failure.message,
      unblock: ['read the reason above, clear it in the worktree, then delete it again'],
    });
  }
  if (failure._tag === 'PreservationConflict' || failure._tag === 'PreservationFailed') {
    return new WorktreeFinishRefused({
      reason: 'git-refused',
      message: failure.message,
      unblock: ['read what git said above and clear it, then delete it again'],
    });
  }
  return new WorktreeFinishRefused({
    reason: 'git-unreadable',
    message: failure.message,
    unblock: ['delete it again: the deletion asks by its key whether its leftover commit landed and never commits twice'],
  });
};

const settledNothing = (failure: PreservationFailure): boolean =>
  failure._tag === 'PreservationRefused' || failure._tag === 'PreservationConflict' || failure._tag === 'PreservationFailed';

const ownGitRefused = (failure: OwnGitFailed): WorktreeFinishRefused =>
  failure.admission !== undefined
    ? finishNotAdmitted(failure.admission)
    : new WorktreeFinishRefused({
        reason: failure.ran ? 'git-refused' : 'git-unreadable',
        message: `${failure.op}: ${failure.message}`,
        unblock: ['read what git said above and clear it, then delete it again'],
      });

export type WorktreeDeletion = {
  readonly delete: (projectId: number, rootId: RootId, end?: TerminalActor) => Effect.Effect<WorktreeDeleted, FinishFailure>;
  readonly recover: () => Effect.Effect<void>;
};

export const makeWorktreeDeletion = Effect.fnUntraced(function* (input: {
  readonly guards: FinishingGuards;
  readonly progress: ActProgress;
  readonly branches: BranchDeletion;
  readonly checks: MergeChecks;
  readonly announce: (projectId: number) => void;
}) {
  const { guards, progress, branches, checks, announce } = input;
  const git = actingGit(yield* Git, 'worktree-finishing');
  const files = yield* FileSystem.FileSystem;
  const units = yield* MachineUnits;
  const { db } = yield* MachineStore;
  const records = yield* WorktreeRecords;
  const intents = yield* makeDeletionIntents;
  const gates = yield* FinishingGate;
  const checkouts = yield* CheckoutRows;
  const holdings = yield* CheckoutHoldings;
  const roots = yield* FileRoots;
  const uses = yield* RootUses;
  const threads = yield* WorktreeThreads;
  const preservation = yield* PreservationCommit;
  const { deliver: graph, ready } = yield* GraphDelivering;
  const settlement = yield* RetirementSettlement;
  const departure = yield* WorktreeDeparture;
  const ending = yield* RootEndings;
  const trees = yield* CommitTrees;
  const retirement = yield* Retirement;

  const departing = <A>(rootId: RootId, work: Effect.Effect<A, FinishFailure>): Effect.Effect<A, FinishFailure> =>
    progress.departs(rootId, gates.hold({ kind: 'root', rootId }, work));

  const enter = (
    key: RequestKey,
    phase: DeletionPhase,
    detail?: { readonly paths: readonly string[]; readonly holders: readonly string[] },
  ): Effect.Effect<void, FinishFailure> => stored(units.write(entering, (unit) => intents.enter(key, phase, unit, detail)));

  const close = (key: RequestKey): Effect.Effect<void, FinishFailure> => stored(units.write(closing, (unit) => intents.close(key, unit)));

  const unused = (rootId: RootId, ended: Ending | null): Effect.Effect<void, FinishFailure> =>
    Effect.flatMap(guards.holders(rootId), (held) =>
      held.length === 0
        ? Effect.void
        : refused(
            'root-in-use',
            `${held.map((use) => ended?.known.get(use.useId) ?? useWords(use)).join(', ')} still ${held.length === 1 ? 'holds' : 'hold'} this worktree`,
            [
              'end what holds it — a terminal or a command running there — then act again',
              ...(ended === null
                ? [
                    'act from a thread bound to this project, or as the operator: either ends the terminals and commands started in the worktree',
                  ]
                : []),
            ],
          ),
    );

  const settle = (record: WorktreeRecord, key: RequestKey): Effect.Effect<void, FinishFailure> => {
    const tables = writes(
      'worktrees.deletion.settle',
      [fileRoot, fileRootNamespace, projectRoot, worktree, worktreeState, worktreeDeletion],
      settlement.writes,
    );
    const told = Effect.flatMap(Effect.result(trees.drop(record.path)), (dropped) =>
      dropped._tag === 'Success'
        ? Effect.void
        : Effect.logWarning('the commit tree of a deleted worktree stayed', { path: record.path, reason: dropped.failure.message }),
    );
    return Effect.tap(
      stored(
        units.write(tables, (unit) =>
          Effect.gen(function* () {
            yield* unit.run(db.delete(worktreeState).where(eq(worktreeState.rootId, record.rootId)));
            yield* records.drop(record.rootId, unit);
            yield* settlement.dropPendingMerge(record.rootId, unit);
            yield* intents.close(key, unit);
            const held = yield* uses.holding(unit, [record.rootId]);
            if (held.length > 0) return;
            yield* Effect.catchTag(
              roots.retireMissing(record.rootId, unit),
              ['RootMissing', 'RootInvalid', 'RootConflict', 'RootRefused', 'RootUnavailable'],
              () => Effect.void,
            );
          }),
        ),
      ),
      () => told,
    );
  };

  const putAway = Effect.fnUntraced(function* (
    projectId: number,
    rootId: RootId,
  ): Effect.fn.Return<WorktreeDeleted['threads'], FinishFailure> {
    const placed = (yield* threads.live(projectId)).filter((one) => one.rootId === rootId && !one.cleared);
    const moved: string[] = [];
    const kept: { threadId: string; reason: string }[] = [];
    for (const one of placed) {
      const put = yield* Effect.result(threads.archive(projectId, one.threadId, true));
      if (put._tag === 'Success') moved.push(one.threadId);
      else kept.push({ threadId: one.threadId, reason: put.failure.message });
    }
    return { moved, kept };
  });

  const undelivered = <R>(record: WorktreeRecord, work: Effect.Effect<unknown, Effect.Error<ReturnType<typeof graph>>, R>) =>
    work.pipe(
      Effect.asVoid,
      Effect.catchTag('GateRefusal', (refusal) =>
        Effect.logInfo('the graph of a deleted worktree did not commit, so its files go with the leftovers', {
          rootId: record.rootId,
          reason: refusal.reason,
        }),
      ),
      Effect.mapError((failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message })),
    );

  const delivered = (record: WorktreeRecord): Effect.Effect<void, FinishFailure> =>
    undelivered(record, graph(record.projectId, record.path));

  const readied = Effect.fnUntraced(function* (projectId: number, rootId: RootId) {
    const record = yield* stored(units.read((unit) => records.byRoot(rootId, unit)));
    if (record === null || record.projectId !== projectId) return;
    if (yield* guards.present(record.path)) yield* undelivered(record, ready(record.projectId, record.path));
  });

  const leftovers = (rootId: RootId): Effect.Effect<Leftovers, FinishFailure> =>
    Effect.flatMap(checkouts.read(rootId), (tree) =>
      tree.stale || tree.incomplete || !tree.repository
        ? refused('git-unreadable', 'what the worktree holds uncommitted could not be read whole, so its folder stays', [
            'read the worktree with read_checkout and delete it again once git answers',
          ])
        : Effect.succeed({
            paths: [
              ...new Set(
                pathsOf(tree, UNCOMMITTED)
                  .flatMap((entry) => (entry.oldPath === undefined ? [entry.path] : [entry.oldPath, entry.path]))
                  .filter((path) => !leftBehind(path)),
              ),
            ],
            untracked: tree.entries.untracked.entries.map((entry) => entry.path).filter((path) => !leftBehind(path)),
          }),
    );

  const clearIndex = Effect.fn('WorktreeDeletion.clearIndex')(
    function* (path: string, key: RequestKey) {
      const { gitDir } = yield* locationsAt(git, path);
      yield* files.remove(join(gitDir, deletionIndexName(key)), { force: true });
    },
    (work, _path, key) =>
      work.pipe(
        Effect.catch((failure) =>
          Effect.logWarning('a deletion index could not be cleaned after recovery', { key, reason: String(failure) }),
        ),
      ),
  );

  const leftoverTree = Effect.fn('WorktreeDeletion.leftoverTree')(function* (
    record: WorktreeRecord,
    key: RequestKey,
    pending: Leftovers,
    holders: readonly string[],
  ): Effect.fn.Return<PreparedChange<PreservedWorktree>, FinishFailure> {
    const { paths, untracked } = pending;
    const additions = new Set(untracked);
    const tracked = paths.filter((path) => !additions.has(path));
    const base = (yield* asked(headAt(git, record.path))).commit;
    const { gitDir } = yield* asked(locationsAt(git, record.path));
    const index = join(gitDir, deletionIndexName(key));
    const env = { GIT_INDEX_FILE: index };
    const staged = yield* stagedEntriesAt(git, record.path, paths);
    if (staged.unread.size > 0) {
      return yield* refused(
        'git-unreadable',
        `the worktree index could not be read: ${[...staged.unread].map(([path, reason]) => `${path}: ${reason}`).join('; ')}`,
        ['read the worktree index with git status, then delete it again once it is readable'],
      );
    }
    const selected = new Set(paths);
    const entries = [...staged.entries]
      .filter(([path]) => selected.has(path))
      .map(([path, entry]) => `${entry.mode} ${entry.object}\t${path}\0`)
      .join('');
    const tree = yield* Effect.mapError(
      Effect.gen(function* () {
        yield* runGit(git, 'deletion-base', ['-C', record.path, 'read-tree', ...(base === null ? ['--empty'] : [base])], { env });
        if (entries !== '') {
          yield* runGit(git, 'deletion-index', ['-C', record.path, 'update-index', '-z', '--index-info'], { env, stdin: entries });
        }
        if (tracked.length > 0) {
          yield* runGit(
            git,
            'deletion-stage',
            ['-C', record.path, '--literal-pathspecs', 'add', '-u', '--pathspec-from-file=-', '--pathspec-file-nul'],
            { env, stdin: tracked.join('\0') },
          );
        }
        if (untracked.length > 0) {
          yield* runGit(
            git,
            'deletion-add',
            ['-C', record.path, '--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'],
            { env, stdin: untracked.join('\0') },
          );
        }
        return yield* runGit(git, 'deletion-tree', ['-C', record.path, 'write-tree'], { env });
      }),
      ownGitRefused,
    ).pipe(Effect.ensuring(Effect.ignore(files.remove(index, { force: true }))));
    return {
      subject: {
        kind: 'tree' as const,
        projectId: record.projectId,
        root: record.path,
        base: base ?? '',
        built: tree.trim(),
        paths: [...paths],
        caller: { name: record.name, holders: [...holders] },
      },
      built: {
        base,
        tree: tree.trim(),
        from: tree.trim(),
        changed: [...paths],
        entries: { base, tree: tree.trim(), before: new Map(), after: new Map() },
        plan: paths.map((path) => ({ path, writers: [...holders], ids: [] })),
        hashes: new Map(),
        reshaped: [],
        formatSkipped: false,
        declaration: [],
      },
      index,
    };
  });

  const commit = Effect.fn('WorktreeDeletion.commit')(function* (
    record: WorktreeRecord,
    key: RequestKey,
    pending: Leftovers,
    holders: readonly string[],
  ): Effect.fn.Return<Committed, FinishFailure> {
    const { paths } = pending;
    yield* enter(key, 'committing', { paths, holders });
    yield* progress.phase(record.rootId, 'committing');
    const prepared = yield* Effect.tapError(leftoverTree(record, key, pending, holders), () => close(key));
    const receipt = yield* Effect.result(preservation.commit(key, prepared));
    if (receipt._tag === 'Success') return { commit: receipt.success.commit, paths: [...paths], holders: [...holders] };
    const failure = receipt.failure;
    if (failure._tag === 'PreservationRefused' && failure.reason === 'nothing-changed') {
      yield* enter(key, 'committing', { paths: [], holders: [] });
      return null;
    }
    if (settledNothing(failure)) yield* close(key);
    return yield* preservationRefusal(failure);
  });

  const detachedKept = Effect.fnUntraced(function* (
    record: WorktreeRecord,
    committed: Committed,
  ): Effect.fn.Return<WorktreeDeleted['branch'] | null, FinishFailure> {
    if (record.branch !== null || committed === null) return null;
    const name = `tagma/kept/${record.name}-${committed.commit.slice(0, 8)}`;
    const common = yield* guards.commonOf(record);
    const standing = yield* asked(commitOf(git, common, `refs/heads/${name}`));
    if (standing === null) {
      yield* Effect.mapError(
        runGit(git, 'deletion-keep', ['-C', common, 'update-ref', `refs/heads/${name}`, committed.commit, '']),
        ownGitRefused,
      );
    }
    return {
      status: 'kept',
      name,
      reason: 'the worktree stood on no branch, so its uncommitted work went onto this new branch',
      commits: [{ sha: committed.commit, subject: '' }],
    } satisfies WorktreeDeleted['branch'];
  });

  const retire = Effect.fn('WorktreeDeletion.retire')(function* (
    record: WorktreeRecord,
    key: RequestKey,
    kept: WorktreeDeleted['branch'] | null,
  ): Effect.fn.Return<Retired, FinishFailure> {
    yield* enter(key, 'removing');
    yield* progress.phase(record.rootId, 'removing');
    yield* asked(checks.forget(record.path));
    const common = yield* guards.commonOf(record);
    const listed = yield* asked(worktreesOf(git, common));
    if (listed[0]?.path === record.path || common.startsWith(`${record.path}/`)) {
      return yield* refused('root-in-use', `${record.path} holds the repository itself, so it is never removed`, [
        'read the worktree record with list_worktrees',
      ]);
    }
    const retired = yield* Effect.result(retirement.gone(record.rootId));
    if (retired._tag === 'Failure')
      yield* Effect.logWarning('the rows of a deleted worktree stay held until the next start', {
        rootId: record.rootId,
        reason: retired.failure.message,
      });
    const administered = listed.some((one) => one.path === record.path);
    const gitDir = administered && (yield* guards.present(record.path)) ? (yield* asked(locationsAt(git, record.path))).gitDir : null;
    yield* withholding(
      gitDir === null ? [record.path] : [record.path, gitDir],
      Effect.gen(function* () {
        if (administered) yield* asked(removeWorktreeAt(git, common, record.path, { force: true }));
        yield* Effect.mapError(
          Effect.uninterruptible(files.remove(record.path, { recursive: true, force: true })),
          (failure) => new WorktreeUnavailable({ reason: 'filesystem', message: failure.message }),
        );
      }),
    );
    const branch = kept ?? (yield* branches.remove(record));
    yield* enter(key, 'placing');
    const placed = yield* putAway(record.projectId, record.rootId);
    yield* settle(record, key);
    yield* departure.departed(record.projectId);
    announce(record.projectId);
    return { branch, threads: placed };
  });

  const endStanding = Effect.fn('WorktreeDeletion.endStanding')(function* (
    projectId: number,
    rootId: RootId,
    requester: TerminalActor,
  ): Effect.fn.Return<Ending, FinishFailure> {
    const held = yield* guards.holders(rootId);
    if (held.length === 0) return NOTHING_ENDED;
    const standing = yield* stored(
      ending(projectId, rootId, requester, held).pipe(
        Effect.mapError((failure) => ({ _tag: 'RootEndingUnread', message: failure.message })),
      ),
    );
    const beyond = standing.filter((one) => one.unreachable !== null);
    if (beyond.length > 0) {
      return yield* refused(
        'root-in-use',
        `${beyond.map((one) => `${executionWords(one)}: ${UNREACHABLE[one.unreachable ?? 'unknown']}`).join('; ')} — so nothing was stopped`,
        ['end what holds it — a terminal or a command running there — then act again'],
      );
    }
    const deadline = (yield* Clock.currentTimeMillis) + ENDING_WAIT_MS;
    const sent = yield* Effect.forEach(
      standing,
      (one) => {
        const key = `worktree-end:${rootId}:${one.shown?.execution.execution ?? one.use.useId}`;
        return Effect.map(Effect.result(one.end(key)), (outcome) => ({
          one,
          key,
          ours: outcome._tag === 'Success' ? outcome.success : false,
          failure: outcome._tag === 'Failure' ? outcome.failure.message : null,
        }));
      },
      { concurrency: 'unbounded' },
    );
    let open = sent;
    const ended: EndedExecution[] = [];
    while (open.length > 0) {
      const left: typeof open = [];
      for (const stop of open) {
        if (!(yield* stored(stop.one.discharged))) left.push(stop);
        else if (stop.ours && stop.one.shown !== null) ended.push(stop.one.shown);
      }
      open = left;
      if (open.length === 0 || open.every((stop) => stop.failure !== null) || (yield* Clock.currentTimeMillis) >= deadline) break;
      yield* Effect.sleep(ENDING_POLL);
    }
    const known = new Map(
      open.map(
        (stop) =>
          [
            stop.one.use.useId,
            `${executionWords(stop.one)}, whose stop ${stop.key} has not ended it${stop.failure === null ? '' : ` (${stop.failure})`}`,
          ] as const,
      ),
    );
    return { ended, known };
  });

  const fresh = Effect.fn('WorktreeDeletion.fresh')(function* (
    projectId: number,
    rootId: RootId,
    end: TerminalActor | undefined,
  ): Effect.fn.Return<WorktreeDeleted, FinishFailure> {
    const record = yield* guards.recorded(projectId, rootId);
    yield* asked(checks.forget(record.path));
    yield* guards.quiet(projectId, rootId);
    const key = RequestKey.make(`worktree-deletion:${rootId}:${uuidv7()}`);
    const first: DeletionPhase = end === undefined ? 'intended' : 'ending';
    const at = new Date(yield* Clock.currentTimeMillis);
    const inserted = yield* stored(
      units.write(intending, (unit) => intents.intend({ key, projectId, rootId, phase: first, paths: [], holders: [], at }, unit)),
    );
    if (!inserted)
      return yield* refused('operation-in-progress', 'an earlier deletion of this worktree is still under way', [
        'wait for the earlier deletion to settle, then ask again',
      ]);
    const unsent = <A>(work: Effect.Effect<A, FinishFailure>) => Effect.tapError(work, () => close(key));
    if (end !== undefined) yield* progress.phase(rootId, 'ending');
    const ended = end === undefined ? null : yield* unsent(endStanding(projectId, rootId, end));
    yield* unsent(unused(rootId, ended));
    const present = yield* unsent(guards.present(record.path));
    if (present) yield* unsent(Effect.flatMap(checkouts.read(rootId), (tree) => still(tree, 'operation-in-progress')));
    if (present) yield* unsent(delivered(record));
    const pending = present ? yield* unsent(leftovers(rootId)) : { paths: [], untracked: [] };
    const held = pending.paths.length === 0 ? new Map() : yield* unsent(stored(holdings.holdersOf(rootId, pending.paths)));
    const holders = [...new Set([...held.values()].flat().map(holderName))];
    const committed = pending.paths.length === 0 ? null : yield* commit(record, key, pending, holders);
    const retired = yield* retire(record, key, yield* detachedKept(record, committed));
    return { rootId, name: record.name, committed, removed: present, ...retired, ended: ended?.ended ?? [] };
  });

  const resume = Effect.fn('WorktreeDeletion.resume')(function* (
    intent: DeletionIntent,
  ): Effect.fn.Return<WorktreeDeleted | null, FinishFailure> {
    const record = yield* stored(units.read((unit) => records.byRoot(intent.rootId, unit)));
    if (record === null) {
      yield* close(intent.key);
      return null;
    }
    if (intent.phase === 'intended' || intent.phase === 'ending') {
      yield* close(intent.key);
      return null;
    }
    yield* clearIndex(record.path, intent.key);
    const receipt = intent.paths.length === 0 ? null : yield* Effect.mapError(preservation.readReceipt(intent.key), preservationRefusal);
    if (intent.paths.length > 0 && receipt === null) {
      if (intent.phase === 'committing') {
        yield* close(intent.key);
        return null;
      }
      return yield* refused('git-unreadable', `the preservation receipt for ${intent.key} is absent after its deletion advanced`, [
        'read the worktree branch and retry the deletion once the preservation receipt answers',
      ]);
    }
    const committed: Committed =
      receipt === null
        ? null
        : {
            commit: receipt.commit,
            paths: [...intent.paths],
            holders: [...intent.holders],
          };
    yield* Effect.andThen(guards.quiet(record.projectId, record.rootId), unused(record.rootId, null));
    const present = yield* guards.present(record.path);
    if (present && (yield* leftovers(record.rootId)).paths.length > 0) {
      yield* close(intent.key);
      return null;
    }
    const retired = yield* retire(record, intent.key, yield* detachedKept(record, committed));
    return { rootId: record.rootId, name: record.name, committed, removed: present, ...retired, ended: [] };
  });

  const resumed = (intent: DeletionIntent): Effect.Effect<void> =>
    departing(intent.rootId, resume(intent)).pipe(
      Effect.asVoid,
      Effect.catch((failure) =>
        Effect.logWarning('an interrupted worktree deletion stays open until it is asked again', {
          key: intent.key,
          phase: intent.phase,
          failure: failure.message,
        }),
      ),
    );

  const deletion: WorktreeDeletion = {
    delete: Effect.fn('WorktreeRetirement.delete')(function* (
      projectId: number,
      rootId: RootId,
      end?: TerminalActor,
    ): Effect.fn.Return<WorktreeDeleted, FinishFailure> {
      return yield* progress.during(
        projectId,
        rootId,
        'delete',
        Effect.scoped(
          Effect.andThen(
            readied(projectId, rootId),
            departing(
              rootId,
              Effect.gen(function* () {
                const open = yield* stored(units.read((unit) => intents.byRoot(rootId, unit)));
                if (open !== null && open.projectId === projectId) {
                  const again = yield* resume(open);
                  if (again !== null) return again;
                }
                return yield* fresh(projectId, rootId, end);
              }),
            ),
          ),
        ),
      );
    }),
    recover: Effect.fn('WorktreeDeletion.recover')(
      function* () {
        let after: { readonly at: Date; readonly key: RequestKey } | null = null;
        for (;;) {
          const page = yield* stored(units.read((unit) => intents.open(after, OPEN_PAGE, unit)));
          yield* Effect.forEach(
            page,
            (intent) =>
              intent instanceof DeletionUnreadable
                ? Effect.logWarning('an open worktree deletion holds a record that cannot be read, so it stays open', {
                    key: intent.key,
                    column: intent.column,
                  })
                : resumed(intent),
            { discard: true },
          );
          const last = page.at(-1);
          if (last === undefined || page.length < OPEN_PAGE) return;
          after = { at: last.at, key: last.key };
        }
      },
      Effect.catch((failure) => Effect.logWarning('open worktree deletions could not be read', { failure: failure.message })),
    ),
  };
  return deletion;
});
