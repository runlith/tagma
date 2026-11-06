import { randomUUID } from 'node:crypto';
import { Clock, Effect } from 'effect';
import type { MergeGit } from '../contract/service/mergeGit.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { isRootFailure } from '../../workspace/contract/wire/roots.js';
import type { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { TerminalActor } from '../../executions/contract/wire/terminals.js';
import { principalOf } from '../../executions/terminals/principals.js';
import type { Checked } from '../../enforcement/contract/wire/checks.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import type { HoldCut, HoldStalled } from '@runlith/held/failures';
import { type FinishFailure, WorktreeFinishRefused, WorktreeUnavailable } from '../../worktrees/contract/wire/failures.js';
import type { FinishingGate } from '../../worktrees/contract/service/retirement.js';
import type { MergeChecks } from '../../worktrees/contract/service/mergeChecks.js';
import type { ActProgress } from '../../worktrees/contract/service/progress.js';
import { asked, gitFailed, holderName, refused, still, stored, underGraph } from '../../worktrees/retirement/finishing.js';
import { rowHolders } from '../../workspace/checkouts/holders.js';
import { inGraphTree } from '../../graph/contract/wire/storage.js';
import type { TreeReady, TreeSync } from '../../graph/contract/service/delivery.js';
import { type FinishingGuards, HEADS } from '../../worktrees/contract/service/finishingGate.js';
import type { WorktreeMerged } from '../contract/wire/merge.js';
import type { MergeOptions } from '../contract/service/merges.js';
import type { GraphCarried, GraphHeld, GraphSettled, TwinBehind } from '../contract/service/graphSyncing.js';
import type { MergeRequestRow } from '../store/mergeRequests.js';
import { conflicting } from './failures.js';
import type { CoAuthored, MergeCommits, MergeCut, Publishing } from './modes.js';
import type { MergeHookRefused } from '../contract/service/mergeGit.js';
import { both, NO_EDITS, NOTHING_CARRIED, type RefusedEdits, unreadSaid } from '../land/reshaping.js';
import { hookFields } from '../contract/wire/receipt.js';
import type { MergePublications, Settled } from './publication.js';
import type { GraphSyncRun, MergeTail } from './tail.js';
import { takeBase, uncommittedOn } from './update.js';

const ATTEMPTS = 3;

const dirsOf = (path: string): readonly string[] => {
  const dirs: string[] = [];
  for (let at = path.lastIndexOf('/'); at > 0; at = path.lastIndexOf('/', at - 1)) dirs.push(path.slice(0, at));
  return dirs;
};

const crossing = (written: ReadonlySet<string>): ((path: string) => boolean) => {
  const above = new Set([...written].flatMap(dirsOf));
  return (path) => written.has(path) || above.has(path) || dirsOf(path).some((dir) => written.has(dir));
};

const undelivered = (failure: Effect.Error<ReturnType<TreeSync>>): FinishFailure =>
  failure._tag === 'GateRefusal'
    ? new WorktreeFinishRefused({
        reason: 'source-dirty',
        message: `the worktree's graph could not be delivered before merging: ${failure.reason}`,
        unblock: failure.unblock,
      })
    : new WorktreeUnavailable({ reason: 'storage', message: failure.message });

const withEdits = (failure: FinishFailure, said: string): FinishFailure | null => {
  if (failure._tag === 'WorktreeFinishRefused')
    return new WorktreeFinishRefused({ reason: failure.reason, message: `${failure.message}${said}`, unblock: failure.unblock });
  if (failure._tag === 'WorktreeUnavailable') {
    return new WorktreeUnavailable({
      reason: failure.reason,
      message: `${failure.message}${said}`,
      operationId: failure.operationId,
    });
  }
  return null;
};

type Merged = {
  readonly key: string;
  readonly request: MergeRequestRow;
  readonly base: string;
  readonly judged: Checked | null;
  readonly touched: readonly string[];
  readonly from: string;
  readonly settled: Settled;
  readonly unrecorded: string | null;
  readonly yielded: readonly string[];
};

const laneRefusals = (baseBranch: string) => ({
  HoldStalled: (failure: HoldStalled) =>
    refused(
      'finishing-busy',
      `the ${failure.resource} of ${baseBranch} stayed held for the ${Math.round(failure.waitedMs / 1000)} s this merge could wait`,
      ['merge again'],
    ),
  HoldCut: (failure: HoldCut) =>
    refused(
      'finishing-cut',
      `the ${failure.resource} step of the merge into ${baseBranch} ran past its ceiling and was cut: ${failure.leaves}`,
      [`read ${baseBranch} before merging again: read_checkout_history`],
    ),
});

type Judging = {
  readonly projectId: number;
  readonly root: string;
  readonly rulesAt: string;
  readonly branch: string;
  readonly base: string;
  readonly built: string;
  readonly debtBase: string;
  readonly paths: readonly string[];
  readonly caller: TerminalActor | undefined;
  readonly parted: boolean;
  readonly workdir: string;
};

const judged = (rules: ActChecks, { caller, parted, ...subject }: Judging): Effect.Effect<Checked, WorktreeFinishRefused> =>
  Effect.flatMap(rules.before({ kind: 'tree', ...subject, caller }), (checked) => {
    const said = checked.refused;
    if (said === null) return Effect.succeed(checked);
    if (!parted) return refused(said.code, said.reason, said.unblock);
    return refused(
      said.code,
      `${said.reason}; the merge's hooks changed the graph past what the worktree holds, so the rules of ${subject.branch}'s graph judged this merge`,
      said.unblock,
    );
  });

export const integrate = (
  git: MergeGit['Service'],
  guards: FinishingGuards,
  gate: FinishingGate['Service'],
  checkouts: CheckoutRows['Service'],
  holdings: CheckoutHoldings['Service'],
  checks: MergeChecks,
  publications: MergePublications,
  tail: MergeTail,
  progress: ActProgress,
  commits: MergeCommits,
  options: {
    readonly sync: TreeSync;
    readonly ready?: TreeReady;
    readonly held?: GraphHeld;
    readonly rules?: ActChecks;
    readonly carried?: GraphCarried;
    readonly settled?: GraphSettled;
    readonly twinBehind?: TwinBehind;
    readonly graph?: GraphSyncRun;
    readonly coAuthored: CoAuthored;
  },
) =>
  Effect.fnUntraced(function* (projectId: number, rootId: RootId, request: MergeOptions): Effect.fn.Return<WorktreeMerged, FinishFailure> {
    const mode = request.mode ?? 'merge';
    const requestId = randomUUID();
    const requestedAt = new Date(yield* Clock.currentTimeMillis);
    return yield* progress.during(
      projectId,
      rootId,
      'merge',
      publications.during(
        requestId,
        Effect.gen(function* () {
          yield* progress.phase(rootId, 'checking');
          const record = yield* guards.recorded(projectId, rootId);
          yield* guards.stands(record);
          const branch = yield* guards.branchOf(record);
          const baseBranch = yield* guards.baseOf(record);
          yield* still(yield* checkouts.read(rootId), 'operation-in-progress');
          const base = yield* guards.baseCheckout(projectId, baseBranch, rootId);
          const carries =
            options.rules === undefined || options.carried === undefined
              ? false
              : yield* Effect.mapError(
                  options.carried(projectId),
                  (failure) =>
                    new WorktreeUnavailable({
                      reason: 'storage',
                      message: `whether this project carries its graph in the tree could not be read: ${failure.message}`,
                    }),
                );
          const coAuthored = yield* Effect.mapError(
            options.coAuthored(projectId),
            (failure) =>
              new WorktreeUnavailable({
                reason: 'storage',
                message: `whether this project's commits name Tagma as co-author could not be read: ${failure.message}`,
              }),
          );
          const attempt = Effect.fnUntraced(function* (left: number): Effect.fn.Return<Merged, FinishFailure> {
            const open = yield* Effect.mapError(publications.holding(rootId), (failure) =>
              failure._tag === 'WorktreeFinishRefused'
                ? new WorktreeFinishRefused({
                    reason: 'git-unreadable',
                    message: `whether an earlier merge of this worktree landed in ${baseBranch} could not be read from git: ${failure.message}`,
                    unblock: [`read ${baseBranch} before merging again: read_checkout_history`],
                  })
                : new WorktreeUnavailable({
                    reason: 'storage',
                    message: `whether an earlier merge of this worktree is finished could not be read: ${failure.message}`,
                  }),
            );
            if (open === 'tail') {
              return yield* refused(
                'finishing-busy',
                `an earlier merge of this worktree published into ${baseBranch} and its receipt and notice are not finished, so a new merge is not started over it`,
                ['merge again once the server has finished the earlier one'],
              );
            }
            if (open === 'uncertain') {
              return yield* refused(
                'finishing-cut',
                `an earlier merge of this worktree was cut while it published into ${baseBranch}, and neither the branch nor its reflog shows whether it landed, so a new merge is not started over it`,
                [`read ${baseBranch} before merging again: read_checkout_history`],
              );
            }
            const synced = yield* Effect.mapError(options.sync(projectId, record.path), undelivered);
            if (synced !== 'ordinary' && synced.left !== undefined) {
              return yield* refused(
                'source-dirty',
                `the worktree's graph holds ${synced.left.files} uncommitted files at ${synced.left.checkout}, and graph.commit is off, so the merge cannot carry the graph it judges`,
                ['set graph.commit to manual or auto, then merge again'],
              );
            }
            const tip = (yield* git.head(record.path)).commit;
            if (tip === null)
              return yield* refused('no-branch', 'this worktree names no commit to merge', ['commit something on its branch first']);
            const reading = yield* checkouts
              .refresh(base.root.rootId)
              .pipe(Effect.mapError((failure) => (isRootFailure(failure) ? failure : gitFailed(failure))));
            const holders = yield* stored(rowHolders(reading, holdings));
            yield* still(reading, 'base-mid-operation');
            const head = yield* git.head(base.root.path);
            const baseTip = head.commit;
            if (baseTip === null || head.ref !== `${HEADS}${baseBranch}`) {
              return yield* refused('base-not-checked-out', `${base.root.path} no longer stands on a commit of ${baseBranch}`, [
                `check out ${baseBranch} there, then merge`,
              ]);
            }
            const checked = yield* asked(checks.fresh(record.path, baseTip, tip));
            if (checked.conflicts.length > 0) return yield* conflicting(baseBranch, checked.conflicts);
            const baseTree = yield* git.tree(base.root.path, baseTip);
            if ((checked.tree === baseTree && checked.yielded.length === 0) || (yield* git.ancestor(base.root.path, tip, baseTip))) {
              return yield* refused('already-merged', `${branch} at ${tip} changes nothing ${baseBranch} does not already hold`, [
                'delete the worktree: delete_worktree',
              ]);
            }
            const guarded = (paths: ReadonlySet<string>): Effect.Effect<void, WorktreeFinishRefused> => {
              const crossed = crossing(paths);
              const staged = reading.entries.staged.entries.filter(
                (entry) => crossed(entry.path) || (entry.oldPath !== undefined && crossed(entry.oldPath)),
              );
              if (staged.length > 0) {
                return refused(
                  'base-staged',
                  `the index of the checkout of ${baseBranch} at ${base.root.path} holds staged entries on paths the merge writes, and bringing the checkout to the merge would overwrite them: ${staged
                    .slice(0, 8)
                    .map((entry) => entry.path)
                    .join(', ')}`,
                  ['commit or unstage those entries in the base checkout, then merge', 'merge when the base is free'],
                );
              }
              const { dirty, held } = uncommittedOn(reading, holders, ['unstaged', 'untracked'], paths);
              if (held.length > 0) {
                const named = [...new Set(held.map(({ holder }) => holderName(holder)))];
                return refused(
                  'base-held',
                  `lines on ${[...new Set(held.map(({ entry }) => entry.path))].join(', ')} in the checkout of ${baseBranch} are held by ${named.join(', ')}, and the merge writes those paths`,
                  [`wait until ${named.join(', ')} commits those lines, then merge`, 'merge when the base is free'],
                );
              }
              if (dirty.length === 0) return Effect.void;
              const graphOnly = dirty.every((entry) => underGraph(entry.path));
              return refused(
                'base-dirty',
                `the checkout of ${baseBranch} holds uncommitted changes nobody's record claims on paths the merge writes: ${dirty.map((entry) => entry.path).join(', ')}`,
                [
                  graphOnly
                    ? 'deliver the graph of the base with sync_graph, then merge'
                    : 'commit or discard those changes in the base checkout, then merge',
                ],
              );
            };
            const touched = new Set(yield* git.changed(base.root.path, baseTip, checked.tree));
            yield* guarded(touched);
            yield* progress.shown(rootId);
            yield* progress.phase(rootId, 'judging');
            const judges = options.rules !== undefined && carries && [...touched].some(inGraphTree);
            const behind = judges ? yield* git.changed(base.root.path, tip, checked.tree) : [];
            const twin =
              options.rules !== undefined && !carries && options.twinBehind !== undefined
                ? yield* Effect.mapError(
                    options.twinBehind(projectId, record.path, branch, baseBranch),
                    (failure) =>
                      new WorktreeUnavailable({
                        reason: 'storage',
                        message: `whether the graph of ${baseBranch} is ahead of the worktree's could not be read: ${failure.reason}`,
                      }),
                  )
                : null;
            const takesGraph = behind.some(inGraphTree);
            const takesTwin = twin === true && !(yield* git.ancestor(base.root.path, baseTip, tip));
            const source =
              takesGraph || takesTwin
                ? yield* takeBase(
                    git,
                    checkouts,
                    holdings,
                  )({
                    record,
                    branch,
                    baseBranch,
                    tip,
                    baseTip,
                    tree: checked.tree,
                    paths: takesGraph ? behind : yield* git.changed(base.root.path, tip, checked.tree),
                    because: takesGraph ? 'both changed the graph' : `its graph holds changes ${branch}'s graph lacks`,
                    coAuthored,
                  }).pipe(Effect.catchTags(laneRefusals(branch)))
                : tip;
            if (source !== tip) {
              took = source;
              tookYielded = checked.yielded;
            }
            let absorbed = twin !== null;
            const bring = options.graph;
            const bringing = bring !== undefined && (twin === true || (carries && source !== tip));
            if (bringing) {
              const brought = yield* bring(projectId, record.path);
              if (brought.status === 'unread')
                return yield* refused(
                  'inspection-failed',
                  `the graph of ${baseBranch} could not be brought into the graph of ${branch} before the merge was judged: ${brought.reason}`,
                  [`read the graph of ${record.path} with sync_graph, then merge again`],
                );
              const conflicted = brought.status === 'synced' ? brought.merges.filter((one) => one.conflicts.length > 0) : [];
              if (conflicted.length > 0)
                return yield* refused(
                  'merge-conflicts',
                  `the graph of ${baseBranch} conflicts with the graph of ${branch} on ${conflicted.flatMap((one) => one.conflicts).join(', ')}, so the merge cannot be judged by the merged graph`,
                  [`resolve the graph conflict in ${record.path} with resolve_graph_conflict, then merge again`],
                );
              const failures = brought.status === 'synced' ? (brought.copyFailures ?? []) : [];
              if (failures.length > 0)
                return yield* refused(
                  'inspection-failed',
                  `a graph copy failed while the graph of ${baseBranch} was brought into the graph of ${branch}: ${failures.map((one) => one.error.reason).join('; ')}`,
                  [`read the graph of ${record.path} with sync_graph, then merge again`],
                );
              if (twin === true) {
                const still = yield* Effect.mapError(
                  options.twinBehind!(projectId, record.path, branch, baseBranch),
                  (failure) =>
                    new WorktreeUnavailable({
                      reason: 'storage',
                      message: `whether the graph of ${baseBranch} is ahead of the worktree's could not be read: ${failure.reason}`,
                    }),
                );
                absorbed = still !== true;
              }
            }
            if ((source !== tip || twin !== null) && options.settled !== undefined && !bringing) {
              yield* Effect.mapError(
                options.settled(projectId, record.path),
                (failure) =>
                  new WorktreeUnavailable({
                    reason: 'storage',
                    message: `the worktree's graph could not take in what ${baseBranch} brought before the merge was judged: ${failure.reason}`,
                  }),
              );
            }
            const cut: MergeCut = {
              mode,
              branch,
              baseBranch,
              tip: source,
              baseTip,
              tree: checked.tree,
              dir: base.root.path,
              message: request.message,
              coAuthored,
            };
            const judging = (built: string, paths: readonly string[]): Effect.Effect<Checked | null, FinishFailure> => {
              const rules = options.rules;
              if (rules === undefined) return Effect.succeed(null);
              const subject = {
                projectId,
                root: base.root.path,
                checkout: record.path,
                branch: baseBranch,
                base: baseTip,
                built,
                debtBase: source,
                paths,
                caller: request.caller,
                workdir: record.path,
              };
              const at = (rulesAt: string, parted: boolean): Effect.Effect<Checked, WorktreeFinishRefused> => {
                const failure = unreadGraphs.get(rulesAt);
                return failure === undefined
                  ? judged(rules, { ...subject, rulesAt, parted })
                  : Effect.succeed({ refused: null, watched: [], unjudged: [{ gate: 'unread', cause: failure }] });
              };
              if (absorbed) return at(record.path, false);
              if (!carries || !paths.some(inGraphTree)) return at(base.root.path, false);
              return Effect.flatMap(git.changed(base.root.path, source, built), (behind) =>
                behind.some(inGraphTree) ? at(base.root.path, true) : at(record.path, false),
              );
            };
            const first = yield* judging(checked.tree, [...touched]);
            const made = yield* commits.hooks(record, cut).pipe(
              Effect.catchTags(laneRefusals(baseBranch)),
              Effect.catchTag('MergeHookRefused', (stopped: MergeHookRefused) => {
                pending.push({ from: stopped.built, to: stopped.left });
                unread = stopped.unread;
                const failure = stopped.failure;
                if (failure._tag === 'HoldCut') return laneRefusals(baseBranch).HoldCut(failure);
                return Effect.fail(failure);
              }),
            );
            const carried = <A>(work: Effect.Effect<A, FinishFailure>): Effect.Effect<A, FinishFailure> =>
              made.left === checked.tree
                ? work
                : Effect.tapError(work, () => Effect.sync(() => pending.push({ from: checked.tree, to: made.left })));
            const paths = made.tree === checked.tree ? [...touched] : yield* carried(git.changed(base.root.path, baseTip, made.tree));
            if (made.tree !== checked.tree) yield* carried(guarded(new Set(paths.filter((path) => !touched.has(path)))));
            const verdict = made.tree === checked.tree ? first : yield* carried(judging(made.tree, paths));
            const witnessed: MergeRequestRow = {
              request: requestId,
              rootId,
              baseRootId: base.root.rootId,
              name: record.name,
              branch,
              baseBranch,
              mode,
              source,
              after: request.after ?? 'keep',
              end: request.end === undefined ? null : principalOf(request.end),
              caller: request.caller ?? null,
              waitedSince: request.waited?.queuedAt ?? null,
              afterState: 'waiting',
              afterDone: null,
              sourcePath: record.path,
              sourceState: mode === 'rebase' ? 'pending' : 'none',
              sourceReason: null,
              rulesAfter: false,
            };
            const publishing: Publishing = (commit) =>
              publications.publish({
                projectId,
                checkout: base.root.path,
                ref: `${HEADS}${baseBranch}`,
                base: baseTip,
                tree: made.tree,
                commit,
                job: `tagma merge ${branch}`,
                request: witnessed,
              });
            yield* progress.phase(rootId, 'landing');
            const merged = yield* carried(commits.land(record, cut, made, publishing).pipe(Effect.catchTags(laneRefusals(baseBranch))));
            if (merged._tag === 'landed') {
              pending.unshift({ from: made.tree, to: made.left });
              return {
                key: merged.key,
                request: witnessed,
                base: merged.base,
                judged: verdict,
                touched: paths,
                from: baseTip,
                settled: merged.settled,
                unrecorded: merged.unrecorded,
                yielded: checked.yielded,
              };
            }
            if (made.left !== checked.tree) pending.push({ from: checked.tree, to: made.left });
            if (left > 1) return yield* attempt(left - 1);
            return yield* refused(
              'finishing-busy',
              `${baseBranch} moved between the judgement and the merge under each of ${ATTEMPTS} attempts`,
              ['merge again once the base has settled'],
            );
          });
          const pending: { readonly from: string; readonly to: string }[] = [];
          let unread: string | null = null;
          let took: string | null = null;
          let tookYielded: readonly string[] = [];
          const unreadGraphs = new Map<string, string>();
          const ahead = Effect.fnUntraced(function* () {
            const held = options.held;
            const holding = (root: string) =>
              held === undefined
                ? Effect.void
                : Effect.match(held(projectId, root), {
                    onSuccess: () => undefined,
                    onFailure: (failure) => {
                      unreadGraphs.set(root, `the graph this merge is judged by could not be opened: ${failure.reason}`);
                    },
                  });
            if (options.rules !== undefined) yield* holding(base.root.path);
            if (held !== undefined && carries) {
              const tip = (yield* git.head(record.path)).commit;
              const baseTip = (yield* git.head(base.root.path)).commit;
              const parted = tip === null || baseTip === null ? [] : yield* git.changed(base.root.path, baseTip, tip, true);
              if (parted.some(inGraphTree)) yield* holding(record.path);
            }
            if (options.ready !== undefined) yield* Effect.mapError(options.ready(projectId, record.path), undelivered);
          });
          const outcome = yield* Effect.result(
            Effect.scoped(
              Effect.andThen(
                ahead(),
                gate.hold({ kind: 'root', rootId }, gate.hold({ kind: 'checkout', path: base.root.path }, attempt(ATTEMPTS))),
              ),
            ),
          );
          const carriedAll = yield* Effect.reduce(
            pending,
            () => NOTHING_CARRIED,
            (sum: RefusedEdits, one) => Effect.map(commits.carry(projectId, base.root.path, one.from, one.to), (now) => both(sum, now)),
          );
          const edits = both(carriedAll, { edits: NO_EDITS, said: '', lost: unreadSaid(unread) });
          if (outcome._tag === 'Failure') {
            const gaveWay =
              tookYielded.length === 0
                ? ''
                : `, and there these graph files of ${branch} gave way to ${baseBranch}: ${tookYielded.join(', ')}`;
            const said = `${edits.said}${edits.lost}${took === null ? '' : `; ${branch} took ${baseBranch} in first, at ${took}, and keeps it${gaveWay}`}`;
            if (said === '') return yield* Effect.fail(outcome.failure);
            const told = withEdits(outcome.failure, said);
            if (told === null) yield* Effect.logWarning('a merge was refused after its hooks edited files', { rootId, edits: said });
            return yield* Effect.fail(told ?? outcome.failure);
          }
          const landed = outcome.success;
          yield* progress.phase(rootId, 'syncing');
          const tailed = yield* tail({
            projectId,
            key: landed.key,
            request: landed.request,
            checkout: base.root.path,
            commit: landed.base,
            from: landed.from,
            paths: landed.touched,
            asked: requestedAt,
          });
          const waited =
            request.waited === undefined ? null : { queuedAt: request.waited.queuedAt.toISOString(), attempts: request.waited.attempts };
          const unrecorded = [
            ...(landed.unrecorded === null ? [] : [landed.unrecorded]),
            ...tailed.unrecorded,
            ...edits.edits.unrecorded.map((path) => `${path} carries the hooks' edits, and its write was not recorded`),
            ...(edits.lost === '' ? [] : [edits.lost.replace(/^; /, '')]),
          ];
          if (unrecorded.length > 0)
            yield* Effect.logWarning('a landed merge was not fully recorded', { rootId, commit: landed.base, unrecorded });
          const synced = tailed.graph;
          const after = tailed.after;
          const watched = landed.judged?.watched ?? [];
          const unjudged = landed.judged?.unjudged ?? [];
          const yielded = [...new Set([...tookYielded, ...landed.yielded])];
          return {
            rootId,
            mode,
            base: { rootId: base.root.rootId, branch: baseBranch, head: landed.base },
            branch: { name: branch, head: tailed.branch },
            graph: synced,
            after,
            waited,
            watched: watched.length === 0 ? undefined : watched,
            bodies: watched.length === 0 ? undefined : landed.judged?.bodies,
            unjudged: unjudged.length === 0 ? undefined : unjudged,
            unsynced: landed.settled.reason === null ? undefined : { paths: [...landed.settled.unsynced], reason: landed.settled.reason },
            unrecorded: unrecorded.length === 0 ? undefined : unrecorded.join('; '),
            yielded: yielded.length === 0 ? undefined : yielded,
            ...hookFields(edits.edits),
          };
        }),
      ),
      { deferred: request.waited !== undefined },
    );
  });
