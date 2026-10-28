import { Effect } from 'effect';
import { Git } from '@runlith/git/Git';
import { gitHubCli } from '@runlith/github/GitHubCli';
import { MachineStore } from '../platform/contract/service/store.js';
import { MachineUnits } from '../platform/contract/service/units.js';
import { Maintenance } from '../platform/contract/service/maintenance.js';
import { actChecks, RuleChecks } from '../enforcement/contract/service/ruleChecks.js';
import { ProjectPolicy, ServedGraphs } from '../graph/contract/service/serving.js';
import { WorktreeOwners } from '../worktrees/contract/service/owners.js';
import { GraphDelivering } from '../worktrees/contract/service/retirement.js';
import { Merges } from './contract/service/merges.js';
import { GraphSyncing } from './contract/service/graphSyncing.js';
import { GraphChanging } from './contract/service/graphChanges.js';
import { MergeReceipts } from './contract/service/receipts.js';
import { makeMergeCoordinator } from './merge/coordinator.js';
import { MergeGit } from './contract/service/mergeGit.js';
import { makeMergeGit } from './merge/git.js';
import { makeMergeQueue } from './queue/pendingMerges.js';
import { mergeReceipts } from './store/receipts.js';
import { Settings } from '../settings/contract/service/values.js';
import { coAuthor } from './contract/wire/settings.js';

export const assembleLanding = Effect.gen(function* () {
  const worktrees = yield* WorktreeOwners;
  const { db } = yield* MachineStore;
  const units = yield* MachineUnits;
  const policy = yield* ProjectPolicy;
  const served = yield* ServedGraphs;
  const git = yield* Git;
  const delivery = yield* GraphDelivering;
  const settings = yield* Settings;
  const mergeGit = yield* makeMergeGit.pipe(Effect.provideService(Git, git));
  const merges = yield* makeMergeCoordinator({
    covered: worktrees.covered,
    checks: worktrees.checks,
    guards: worktrees.guards,
    progress: worktrees.progress,
    announce: worktrees.announce,
    graph: yield* GraphSyncing,
    sync: delivery.sync,
    ready: delivery.ready,
    held: (projectId, checkout) => Effect.asVoid(served.hold({ projectId, cwd: checkout })),
    gh: gitHubCli.run,
    graphChanges: yield* GraphChanging,
    carried: (projectId) => Effect.map(policy.read([projectId]), (rows) => rows.get(projectId)?.storage === 'team'),
    settled: (projectId, checkout) => Effect.flatMap(served.resolve({ projectId, cwd: checkout }), (graph) => graph.settled(true)),
    rules: actChecks(yield* RuleChecks, 'merge_worktree'),
    coAuthored: (projectId) => settings.value(coAuthor, projectId),
  }).pipe(Effect.provideService(MergeGit, mergeGit), Effect.provideService(MergeReceipts, mergeReceipts(db, units)));
  const pending = yield* makeMergeQueue().pipe(Effect.provideService(Merges, merges));
  yield* Effect.forkScoped(
    (yield* Maintenance).opened.pipe(
      Effect.andThen(merges.recover()),
      Effect.tap(({ aborted, published, uncertain, unread }) =>
        Effect.all(
          [
            aborted.length === 0 ? Effect.void : Effect.logWarning('interrupted worktree merges were aborted', { aborted }),
            published.length === 0
              ? Effect.void
              : Effect.logWarning('worktree merges interrupted after they published were settled', { published }),
            uncertain.length === 0
              ? Effect.void
              : Effect.logWarning(
                  'worktree merges cut while they published may or may not have landed; their witnesses stay open and their queued retries stopped',
                  { uncertain },
                ),
            unread.length === 0
              ? Effect.void
              : Effect.logWarning('checkouts could not be read for an interrupted worktree merge', { unread }),
          ],
          { discard: true },
        ),
      ),
      Effect.tapCause((cause) => Effect.logWarning('interrupted worktree merges could not be read', { cause })),
      Effect.andThen(pending.resume()),
    ),
  );
  return { merges, pending };
});
