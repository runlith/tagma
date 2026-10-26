import { Effect } from 'effect';
import type { MergeGit } from '../contract/service/mergeGit.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import type { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import type { FinishFailure } from '../../worktrees/contract/wire/failures.js';
import type { FinishingGate } from '../../worktrees/contract/service/retirement.js';
import type { ActProgress } from '../../worktrees/contract/service/progress.js';
import type { GitHubCli, ProgramFailure } from '@runlith/github/GitHubCli';
import { pathsOf, refused } from '../../worktrees/retirement/finishing.js';
import { type FinishingGuards, UNCOMMITTED } from '../../worktrees/contract/service/finishingGate.js';
import type { WorktreePullRequest } from '../contract/wire/merge.js';
import type { PullRequestDraft } from '../contract/service/merges.js';

export type GhRun = GitHubCli['run'];

const ghRefused = (failure: ProgramFailure, context: string) =>
  refused(failure._tag === 'ProgramUnavailable' ? 'no-gh' : 'gh-refused', `${context}: ${failure.detail}`, [
    failure._tag === 'ProgramUnavailable'
      ? 'install gh and sign in with `gh auth login`, then open the pull request again'
      : 'read what gh said above and clear it, then open the pull request again',
  ]);

const urlOf = (printed: string): string | undefined =>
  printed
    .split('\n')
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^https?:\/\/\S+$/.test(line));

export const openPullRequest =
  (
    git: MergeGit['Service'],
    guards: FinishingGuards,
    gate: FinishingGate['Service'],
    checkouts: CheckoutRows['Service'],
    gh: GhRun,
    progress: ActProgress,
  ) =>
  (projectId: number, rootId: RootId, draft: PullRequestDraft): Effect.Effect<WorktreePullRequest, FinishFailure> =>
    progress.during(
      projectId,
      rootId,
      'pull-request',
      gate.hold(
        { kind: 'root', rootId },
        Effect.gen(function* () {
          const record = yield* guards.recorded(projectId, rootId);
          yield* guards.stands(record);
          const branch = yield* guards.branchOf(record);
          const baseBranch = yield* guards.baseOf(record);
          const installed = yield* Effect.result(gh(['--version'], record.path));
          if (installed._tag === 'Failure')
            return yield* ghRefused(installed.failure, 'gh could not be checked before opening a pull request');
          const target = yield* git.remote(record.path, branch);
          if (target === null) {
            return yield* refused('no-remote', `${branch} has no remote to publish to`, [
              'add a remote to the repository, then open the pull request again',
            ]);
          }
          const { remote, branch: head } = target;
          const tree = yield* checkouts.read(rootId);
          yield* progress.phase(rootId, 'pushing');
          yield* git.push(record.path, branch, target);
          yield* checkouts.mark(rootId);
          const uncommitted = new Set(pathsOf(tree, UNCOMMITTED).map((entry) => entry.path)).size;
          yield* progress.phase(rootId, 'opening');
          const standing = yield* Effect.result(
            gh(['pr', 'list', '--head', head, '--state', 'open', '--json', 'url', '--jq', '.[0].url // ""'], record.path),
          );
          if (standing._tag === 'Failure')
            return yield* ghRefused(standing.failure, `${head} was pushed to ${remote}, but gh could not read its open pull requests`);
          const open = urlOf(standing.success.stdout);
          if (open !== undefined) return { rootId, remote, branch: head, base: baseBranch, url: open, opened: false, uncommitted };
          if (standing.success.stdout.trim() !== '')
            return yield* refused('gh-refused', `gh returned no readable pull request URL for ${head}`, [
              'read gh’s answer and clear it before opening a pull request again',
            ]);
          const ended = yield* Effect.result(
            gh(
              [
                'pr',
                'create',
                '--head',
                head,
                '--base',
                baseBranch,
                ...(draft.title === undefined ? ['--fill'] : ['--title', draft.title, '--body', draft.body ?? '']),
                ...(draft.draft === true ? ['--draft'] : []),
              ],
              record.path,
            ),
          );
          if (ended._tag === 'Failure')
            return yield* ghRefused(ended.failure, `${head} was pushed to ${remote}, but gh did not confirm a new pull request`);
          const url = urlOf(ended.success.stdout);
          if (url === undefined) {
            return yield* refused('gh-refused', `${head} was pushed to ${remote}, but gh returned no pull request URL`, [
              'read what gh said above and clear it — `gh auth status` answers whether it is signed in — then open the pull request again',
            ]);
          }
          return { rootId, remote, branch: head, base: baseBranch, url, opened: true, uncommitted };
        }),
      ),
    );
