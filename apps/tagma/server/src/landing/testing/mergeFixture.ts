import { Effect, PubSub, Stream } from 'effect';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { CheckoutHoldings, CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { CheckoutArea, CheckoutState } from '../../workspace/contract/wire/checkout.js';
import type { FinishingGuards, FinishingThreads } from '../../worktrees/contract/service/finishingGate.js';
import { FinishingGate, WorktreeRetirement } from '../../worktrees/contract/service/retirement.js';
import type { WorktreeRecord } from '../../worktrees/contract/service/worktrees.js';
import type { ActChecks } from '../../enforcement/contract/service/ruleChecks.js';
import type { ActProgress } from '../../worktrees/contract/service/progress.js';
import type { MergeChecks } from '../../worktrees/contract/service/mergeChecks.js';
import type { GraphHeld } from '../contract/service/graphSyncing.js';
import { MergeGit } from '../contract/service/mergeGit.js';
import { Merges } from '../contract/service/merges.js';
import type { MergeReceipt } from '../contract/wire/merge.js';
import { integrate } from '../merge/integrate.js';
import { checkMerge } from '../merge/check.js';
import { makeMergeCommits } from '../merge/modes.js';
import { mergePublications } from '../merge/publication.js';
import { mergeTail } from '../merge/tail.js';
import { makeMergeQueue } from '../queue/pendingMerges.js';
import { PendingBoard, pendingMoves } from '../queue/board.js';
import { memoryMerges } from './memoryMerges.js';
import { memoryMergeJournal } from './memoryJournal.js';

export const BASE_ROOT = RootId.make('base');
export const SIDE_ROOT = RootId.make('side');
const empty = (): CheckoutArea => ({ entries: [], added: 0, removed: 0 });
const unused = () => Effect.die('the merge fixture reached an unrelated operation');

export const mergeFixture = Effect.fnUntraced(function* (
  options: {
    readonly rules?: ActChecks;
    readonly carried?: boolean;
    readonly held?: GraphHeld;
  } = {},
) {
  const memory = memoryMerges();
  const journal = memoryMergeJournal();
  const baseTree = memory.tree({ 'seed.txt': 'seed\n' });
  const sideTree = memory.tree({ 'seed.txt': 'seed\n', 'feature.txt': 'feature\n' });
  const base = memory.commit({ tree: baseTree, parents: [], message: 'base', sign: false });
  const tip = memory.commit({ tree: sideTree, parents: [base], message: 'feature', sign: false });
  memory.place('/main', 'refs/heads/main', base);
  memory.place('/side', 'refs/heads/side', tip);
  memory.compare(base, tip, { tree: sideTree, conflicts: [], yielded: [] });
  memory.replayed(base, tip, tip);
  const baseChanges = yield* PubSub.sliding<CheckoutState>({ capacity: 1, replay: 1 });
  const sideChanges = yield* PubSub.sliding<CheckoutState>({ capacity: 1, replay: 1 });
  yield* Effect.addFinalizer(() => Effect.all([PubSub.shutdown(baseChanges), PubSub.shutdown(sideChanges)]));
  const changes = (root: RootId) => (root === BASE_ROOT ? baseChanges : sideChanges);
  const states = new Map<RootId, CheckoutState>();
  const held = new Map<string, readonly import('../../workspace/contract/wire/checkout.js').CheckoutHolder[]>();
  const state = (root: RootId): CheckoutState => {
    const saved = states.get(root);
    const path = root === BASE_ROOT ? '/main' : '/side';
    const checkout = memory.checkouts.get(path)!;
    const head = checkout.ref === null ? checkout.detached : (memory.refs.get(checkout.ref) ?? null);
    return {
      rootId: root,
      path,
      revision: 1,
      head,
      ref: checkout.ref,
      upstream: null,
      publishTo: null,
      ahead: null,
      behind: null,
      operation: 'none',
      entries: { staged: empty(), unstaged: empty(), untracked: empty(), unmerged: empty() },
      compare: null,
      unresolvedBase: null,
      coverage: { untracked: 'all', paths: null },
      repository: true,
      incomplete: false,
      stale: false,
      unwatched: false,
      slowStatus: false,
      ...saved,
    };
  };
  const checkouts = CheckoutRows.of({
    read: (root) => Effect.sync(() => state(root)),
    refresh: (root) => Effect.sync(() => state(root)),
    subscribe: (root) => Stream.fromPubSub(changes(root)),
    follow: (root) => Effect.succeed(Stream.fromPubSub(changes(root))),
    mark: (root) => Effect.asVoid(PubSub.publish(changes(root), state(root))),
    onMark: () => () => {},
    headMoved: () => Stream.never,
    headObserved: () => Stream.never,
    checkoutsMoved: () => Stream.never,
  });
  yield* PubSub.publish(baseChanges, state(BASE_ROOT));
  yield* PubSub.publish(sideChanges, state(SIDE_ROOT));
  const holdings = CheckoutHoldings.of({ holdersOf: () => Effect.succeed(held) });
  const record: WorktreeRecord = {
    rootId: SIDE_ROOT,
    projectId: 1,
    name: 'side',
    path: '/side',
    branch: 'side',
    baseBranch: 'main',
    baseCommit: base,
    origin: 'created',
    hue: 0,
    setup: 'done',
    setupDetail: null,
    taskId: null,
    createdAt: new Date(0),
  };
  const guards: FinishingGuards = {
    recorded: () => Effect.succeed(record),
    present: (path) => Effect.succeed(memory.checkouts.has(path)),
    stands: () => Effect.void,
    branchOf: () => Effect.succeed('side'),
    baseOf: () => Effect.succeed('main'),
    working: () => Effect.succeed([]),
    retiring: () => Effect.succeed([]),
    quiet: () => Effect.void,
    holders: () => Effect.succeed([]),
    baseCheckout: () => Effect.succeed({ root: { projectId: 1, rootId: BASE_ROOT, path: '/main', origin: 'canonical' } }),
    placeOf: () => Effect.succeed({ folder: '/side', base: '/main' }),
    operationOf: unused,
    commonOf: () => Effect.succeed('memory'),
  };
  const gate = FinishingGate.of({ hold: (_key, work) => work });
  const checks: MergeChecks = {
    check: (_dir, base, tip) => memory.comparison(base, tip),
    fresh: (_dir, base, tip) => memory.comparison(base, tip),
    holds: unused,
    saved: unused,
    last: unused,
    standing: unused,
    onTaken: () => () => {},
    forget: () => Effect.void,
  };
  const threads: FinishingThreads = {
    live: () => Effect.succeed([]),
    placedIn: () => Effect.succeed([]),
    archive: unused,
    stop: unused,
    place: unused,
  };
  const deleted = new Set<string>();
  const retirement = WorktreeRetirement.of({
    delete: (_project, root) =>
      Effect.sync(() => {
        deleted.add(root);
        memory.checkouts.delete('/side');
        return {
          rootId: root,
          name: 'side',
          committed: null,
          removed: true,
          threads: { moved: [], kept: [] },
          ended: [],
          branch: { status: 'deleted' as const, name: 'side' },
        };
      }),
    place: unused,
    terms: unused,
  });
  const receipts: MergeReceipt[] = [];
  const publications = mergePublications(memory.git, journal.lifecycle, journal.mergeRequests);
  const tail = mergeTail(
    memory.git,
    checkouts,
    threads,
    retirement,
    () => Effect.succeed({ status: 'synced', merges: [] }),
    (_project, receipt, key, asked) =>
      Effect.gen(function* () {
        receipts.push(receipt);
        yield* journal.pendingStore.dropAsked(receipt.rootId, asked, journal.unit);
        yield* journal.mergeRequests.close(journal.unit, key);
      }),
    journal.mergeRequests,
    () => {},
    options.rules,
  );
  const commits = yield* makeMergeCommits().pipe(Effect.provideService(MergeGit, memory.git));
  const unread = () => {
    throw new Error('the merge fixture reads no progress projection');
  };
  const progress: ActProgress = {
    of: unread,
    leaving: unread,
    departs: unused,
    onMoved: unread,
    during: (_project, _root, _act, work) => work,
    detached: unused,
    shown: () => Effect.void,
    phase: () => Effect.void,
    queue: unused,
  };
  const merge = integrate(memory.git, guards, gate, checkouts, holdings, checks, publications, tail, progress, commits, {
    sync: () => Effect.succeed('ordinary'),
    rules: options.rules,
    held: options.held,
    carried: () => Effect.succeed(options.carried ?? false),
    coAuthored: () => Effect.succeed(true),
  });
  const merges = Merges.of({
    merge,
    checkMerge: checkMerge(memory.git, guards, checks, undefined),
    openPullRequest: unused,
    recover: unused,
    placeOf: guards.placeOf,
    termsOf: unused,
    baseRootOf: () => Effect.succeed(BASE_ROOT),
  });
  const moves = pendingMoves();
  const queue = () =>
    makeMergeQueue({ retry: '1 hour' }).pipe(
      Effect.provideService(MachineUnits, journal.units),
      Effect.provideService(PendingBoard, { store: journal.pendingStore, moves }),
      Effect.provideService(Merges, merges),
      Effect.provideService(CheckoutRows, checkouts),
      Effect.provideService(CheckoutHoldings, holdings),
    );
  return {
    memory,
    journal,
    base,
    tip,
    baseTree,
    sideTree,
    states,
    state,
    held,
    record,
    guards,
    gate,
    checks,
    checkouts,
    holdings,
    merges,
    publications,
    tail,
    receipts,
    deleted,
    queue,
    change: (root: RootId, update: Partial<CheckoutState>) =>
      Effect.andThen(
        Effect.sync(() => {
          states.set(root, { ...state(root), ...update });
        }),
        checkouts.mark(root),
      ),
  };
});
