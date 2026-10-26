import { RequestKey } from '../../platform/contract/wire/ids.js';
import { Effect, FileSystem } from 'effect';
import { ancestorAt } from '@runlith/git/history';
import {
  branchNameAt,
  commitOf,
  headAt,
  publishRemoteAt,
  pushedFromHereAt,
  remoteUrlAt,
  troubleOf,
  upstreamAt,
  type GitAnswerInvalid,
  type GitRefused,
  type GitUnreadable,
  type Upstream,
} from '@runlith/git/repository';
import { deleteRemoteBranchAt, pushAt, setUpstreamAt } from '@runlith/git/porcelain';
import { Git } from '@runlith/git/Git';
import { actingGit } from '../../platform/git/ownGit.js';
import type { StoreFailure } from '../../platform/contract/service/store.js';
import { MachineUnits } from '../../platform/contract/service/units.js';
import { Settings } from '../../settings/contract/service/values.js';
import { worktreeBranchPrefix } from '../contract/wire/settings.js';
import { FinishingGate } from '../contract/service/retirement.js';
import type { Unblock } from '../../platform/contract/wire/refusal.js';
import type { RootId } from '../../workspace/contract/wire/ids.js';
import { WorktreeFinishRefused, type FinishFailure, type FinishReason } from '../contract/wire/failures.js';
import {
  namedBranch,
  type RenamedPullRequest,
  type RenamedRemote,
  type RenameRemote,
  type WorktreeRenamed,
} from '../contract/wire/creation.js';
import { WorktreeUnavailable } from '../contract/wire/failures.js';
import { keepName, keptNameOf } from '../../workspace/repositories/pushName.js';
import type { ProvisionalBranches } from './provisional.js';
import { finishNotAdmitted, gitFailed } from '../retirement/finishing.js';
import { ProgramFailed, type GitHubCli, type ProgramFailure } from '@runlith/github/GitHubCli';
import type { ActProgress } from '../contract/service/progress.js';
import { type WorktreeRecord, WorktreeRecords } from '../contract/service/worktrees.js';
import { WorktreeIntents } from '../contract/service/intents.js';
import { WorktreeRenames } from '../contract/service/renames.js';

type GitFailure = GitUnreadable | GitRefused | GitAnswerInvalid;

type Hosted = { readonly repo: string; readonly owner: string };

type Published = { readonly upstream: Upstream; readonly untracked: boolean };

type OpenPullRequest = RenamedPullRequest & {
  readonly title: string;
  readonly body: string;
  readonly base: string;
  readonly draft: boolean;
  readonly cross: boolean;
};

const HEADS = 'refs/heads/';

const refused = (reason: FinishReason, message: string, unblock: Unblock): Effect.Effect<never, WorktreeFinishRefused> =>
  Effect.fail(new WorktreeFinishRefused({ reason, message, unblock }));

const asked = <A>(work: Effect.Effect<A, GitFailure>): Effect.Effect<A, WorktreeFinishRefused> =>
  Effect.mapError(work, (failure) =>
    failure._tag === 'GitUnreadable' && failure.admission !== undefined
      ? finishNotAdmitted(failure.admission)
      : new WorktreeFinishRefused({
          reason: failure._tag === 'GitRefused' ? 'git-refused' : failure._tag === 'GitAnswerInvalid' ? 'git-incomplete' : 'git-unreadable',
          message: troubleOf(failure),
          unblock: ['read what git said above and clear it, then rename again'],
        }),
  );

const stored = <A>(work: Effect.Effect<A, StoreFailure>): Effect.Effect<A, WorktreeUnavailable> =>
  Effect.mapError(work, (failure) => new WorktreeUnavailable({ reason: 'storage', message: failure.message }));

const said = (failure: ProgramFailure): string => failure.detail;

const HOSTED = [
  /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

export const hostedRepo = (url: string): string | null => {
  for (const shape of HOSTED) {
    const parts = shape.exec(url);
    if (parts !== null) return `${parts[1]}/${parts[2]}/${parts[3]}`;
  }
  return null;
};

const openOf = (printed: string, head: string, owner: string): Effect.Effect<OpenPullRequest | null, ProgramFailed> =>
  Effect.try({
    try: () => {
      const rows: unknown = JSON.parse(printed);
      if (!Array.isArray(rows)) throw new Error('gh returned no pull request list');
      for (const value of rows) {
        if (typeof value !== 'object' || value === null) throw new Error('gh returned an invalid pull request row');
        const one = value as Record<string, unknown>;
        const headOwner = (one.headRepositoryOwner as { login?: unknown } | null | undefined)?.login;
        if (one.headRefName !== head || typeof headOwner !== 'string' || headOwner.toLowerCase() !== owner.toLowerCase()) continue;
        if (typeof one.number !== 'number' || typeof one.url !== 'string' || one.url === '')
          throw new Error('gh returned an invalid pull request identity');
        return {
          number: one.number,
          url: one.url,
          title: typeof one.title === 'string' ? one.title : '',
          body: typeof one.body === 'string' ? one.body : '',
          base: typeof one.baseRefName === 'string' ? one.baseRefName : '',
          draft: one.isDraft === true,
          cross: one.isCrossRepository === true,
        };
      }
      return null;
    },
    catch: (cause) => new ProgramFailed({ phase: 'read', detail: cause instanceof Error ? cause.message : String(cause) }),
  });

const urlOf = (printed: string): string | undefined =>
  printed
    .split('\n')
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^https?:\/\/\S+$/.test(line));

const numberOf = (url: string): number | null => {
  const found = /\/pull\/(\d+)\/?$/.exec(url);
  return found === null ? null : Number(found[1]);
};

export const makeBranchRenames = Effect.fnUntraced(function* (input: {
  readonly branches: ProvisionalBranches;
  readonly gh: GitHubCli['run'];
  readonly mark?: (rootId: RootId) => Effect.Effect<void>;
  readonly progress?: ActProgress;
}) {
  const { branches, gh, mark, progress } = input;
  const units = yield* MachineUnits;
  const records = yield* WorktreeRecords;
  const intents = yield* WorktreeIntents;
  const git = actingGit(yield* Git, 'worktree-rename');
  const files = yield* FileSystem.FileSystem;
  const settings = yield* Settings;
  const gates = yield* FinishingGate;
  const gate = <A, E>(rootId: RootId, work: Effect.Effect<A, E>) => gates.hold({ kind: 'root', rootId }, work);
  const prefix = (projectId: number) => settings.value(worktreeBranchPrefix, projectId);

  const counterpart = Effect.fn('WorktreeRenames.counterpart')(function* (
    path: string,
    from: string,
  ): Effect.fn.Return<Published | null, GitFailure> {
    const upstream = yield* upstreamAt(git, path, from);
    if (upstream !== null && (upstream.branch === from || (yield* keptNameOf(git, path, from)) === upstream.branch)) {
      return { upstream, untracked: false };
    }
    const remote = yield* publishRemoteAt(git, path, from);
    if (remote === null || (yield* commitOf(git, path, `refs/remotes/${remote}/${from}`)) === null) return null;
    return { upstream: { remote, branch: from }, untracked: upstream === null };
  });

  const remember = Effect.fnUntraced(function* (
    record: WorktreeRecord,
    to: string,
    published: Published,
    settled: RenamedRemote,
  ): Effect.fn.Return<void, GitFailure> {
    if (settled.status === 'kept') {
      if (published.untracked) yield* setUpstreamAt(git, record.path, to, published.upstream);
      yield* keepName(git, record.path, to, published.upstream.branch);
    } else {
      yield* keepName(git, record.path, to, null);
    }
  });

  const spelled = Effect.fnUntraced(function* (record: WorktreeRecord, name: string): Effect.fn.Return<string, FinishFailure> {
    const named = yield* stored(prefix(record.projectId));
    const wanted = namedBranch(named, name);
    if (wanted === '' || wanted === named)
      return yield* refused('name-invalid', 'a branch needs a name after its prefix', ['name the branch']);
    const present = yield* Effect.mapError(
      files.exists(record.path),
      (failure) =>
        new WorktreeUnavailable({
          reason: 'filesystem',
          message: `the folder of ${record.name}, ${record.path}, could not be read: ${failure.message}`,
        }),
    );
    if (!present) {
      return yield* refused('folder-missing', `the folder of ${record.name}, ${record.path}, no longer stands`, [
        'delete the worktree whose folder is gone: delete_worktree',
      ]);
    }
    const checked = yield* Effect.result(branchNameAt(git, record.path, wanted));
    if (checked._tag === 'Success') return checked.success;
    return checked.failure._tag === 'GitRefused'
      ? yield* refused('name-invalid', checked.failure.message.replace(/^fatal:\s*/, '') || `${wanted} is not a valid branch name`, [
          'name it without spaces at the ends, `..`, `~`, `^`, `:`, `?`, `*`, `[`, `\\` or a trailing `.lock`',
        ])
      : yield* asked(Effect.fail(checked.failure));
  });

  const hosted = Effect.fn('WorktreeRenames.hosted')(function* (record: WorktreeRecord, remote: string): Effect.fn.Return<Hosted | string> {
    const url = yield* Effect.result(remoteUrlAt(git, record.path, remote));
    if (url._tag === 'Failure')
      return `git could not read where ${remote} points (${troubleOf(url.failure)}), so the remote keeps its branch`;
    const repo = url.success === null ? null : hostedRepo(url.success);
    if (repo === null) return `${remote} is not a GitHub repository, so the branch was renamed here only and the remote keeps its name`;
    const known = yield* Effect.result(gh(['repo', 'view', repo, '--json', 'url'], record.path));
    if (known._tag === 'Failure' && known.failure._tag === 'ProgramUnavailable')
      return 'gh is not installed, so Tagma cannot tell whether the remote is on GitHub or has an open pull request; the remote keeps its branch';
    if (known._tag === 'Failure')
      return `gh does not answer for ${repo} (${said(known.failure)}), so it is not treated as GitHub and the remote keeps its branch`;
    return { repo, owner: repo.split('/')[1] ?? '' };
  });

  const dropped = Effect.fn('WorktreeRenames.dropped')(function* (
    record: WorktreeRecord,
    upstream: Upstream,
    to: string,
  ): Effect.fn.Return<{ readonly deleted: boolean; readonly reason: string | null }> {
    const keep = (reason: string) => ({ deleted: false, reason });
    const operation = yield* Effect.result(intents.byId(RequestKey.make(record.origin)));
    if (operation._tag === 'Failure') {
      return keep(
        `the creation that made this branch could not be read (${operation.failure.message}), so ${upstream.remote}/${upstream.branch} is left standing`,
      );
    }
    if (operation.success === null || operation.success.mode.kind !== 'new-branch') {
      return keep(`Tagma did not create this branch, so ${upstream.remote}/${upstream.branch} is not Tagma's to delete`);
    }
    const here = yield* Effect.result(pushedFromHereAt(git, record.path, upstream.remote, upstream.branch));
    if (here._tag === 'Failure') return keep(`git could not say who pushed ${upstream.branch}: ${troubleOf(here.failure)}`);
    if (!here.success)
      return keep(`${upstream.remote}/${upstream.branch} was not first pushed from this repository, so it is left standing`);
    const tip = yield* Effect.result(commitOf(git, record.path, `refs/remotes/${upstream.remote}/${upstream.branch}`));
    if (tip._tag === 'Failure') return keep(`${upstream.remote}/${upstream.branch} could not be read: ${troubleOf(tip.failure)}`);
    if (tip.success === null) return keep(`${upstream.remote}/${upstream.branch} no longer stands here`);
    const held = yield* Effect.result(ancestorAt(git, record.path, tip.success, `${HEADS}${to}`));
    if (held._tag === 'Failure') {
      return keep(`git could not say whether ${to} holds ${upstream.remote}/${upstream.branch}: ${troubleOf(held.failure)}`);
    }
    if (!held.success) return keep(`${upstream.remote}/${upstream.branch} holds commits ${to} does not`);
    const gone = yield* Effect.result(
      deleteRemoteBranchAt(git, record.path, { remote: upstream.remote, branch: upstream.branch, expect: tip.success }),
    );
    return gone._tag === 'Success' ? { deleted: true, reason: null } : keep(troubleOf(gone.failure));
  });

  const remoteOf = Effect.fn('WorktreeRenames.remote')(function* (
    record: WorktreeRecord,
    to: string,
    upstream: Upstream,
    choice: RenameRemote,
  ): Effect.fn.Return<RenamedRemote> {
    const kept = (reason: string, pullRequest: RenamedPullRequest | null = null): RenamedRemote => ({
      status: 'kept',
      remote: upstream.remote,
      branch: upstream.branch,
      pullRequest,
      reason,
    });
    const host = yield* hosted(record, upstream.remote);
    if (typeof host === 'string') return kept(host);
    const listed = yield* Effect.result(
      gh(
        [
          'pr',
          'list',
          '--head',
          upstream.branch,
          '--state',
          'open',
          '--limit',
          '100',
          '--json',
          'number,url,title,body,baseRefName,isDraft,headRefName,headRepositoryOwner,isCrossRepository',
        ],
        record.path,
      ),
    );
    if (listed._tag === 'Failure') {
      return kept(
        `gh could not say whether ${upstream.branch} has an open pull request (${said(listed.failure)}), so the remote keeps ${upstream.branch}`,
      );
    }
    const read = yield* Effect.result(openOf(listed.success.stdout, upstream.branch, host.owner));
    if (read._tag === 'Failure')
      return kept(`gh's pull request list could not be read (${read.failure.detail}), so the remote keeps ${upstream.branch}`);
    const open = read.success;
    if (open !== null && choice === 'keep') {
      return kept(`pull request #${open.number} stays open on ${upstream.branch}, so Tagma keeps pushing ${to} there`, {
        number: open.number,
        url: open.url,
      });
    }
    const pushed = yield* Effect.result(
      pushAt(git, record.path, {
        target: { remote: upstream.remote, branch: to },
        setUpstream: open === null,
        absent: true,
      }),
    );
    if (pushed._tag === 'Failure') {
      return kept(
        `${to} could not be pushed to ${upstream.remote}, so pushes keep going to ${upstream.branch}: ${troubleOf(pushed.failure)}`,
        open === null ? null : { number: open.number, url: open.url },
      );
    }
    if (open === null) return { status: 'moved', remote: upstream.remote, pullRequest: null, old: yield* dropped(record, upstream, to) };
    const created = yield* Effect.result(
      gh(
        [
          'pr',
          'create',
          '--head',
          open.cross ? `${host.owner}:${to}` : to,
          '--base',
          open.base || (record.baseBranch ?? ''),
          '--title',
          open.title || to,
          '--body',
          `${open.body}${open.body === '' ? '' : '\n\n'}Moved from ${open.url} when the branch was renamed from ${upstream.branch} to ${to}.`,
          ...(open.draft ? ['--draft'] : []),
        ],
        record.path,
      ),
    );
    const url = created._tag === 'Success' ? urlOf(created.success.stdout) : undefined;
    const number = url === undefined ? null : numberOf(url);
    if (url === undefined || number === null) {
      const reason = created._tag === 'Failure' ? said(created.failure) : 'gh returned no pull request URL';
      return kept(
        `${to} was pushed to ${upstream.remote}, but gh did not confirm a new pull request (${reason}), so #${open.number} stays open on ${upstream.branch}`,
        { number: open.number, url: open.url },
      );
    }
    const pointed = yield* Effect.result(setUpstreamAt(git, record.path, to, { remote: upstream.remote, branch: to }));
    if (pointed._tag === 'Failure')
      yield* Effect.logWarning('a renamed worktree branch kept its old upstream', {
        rootId: record.rootId,
        reason: troubleOf(pointed.failure),
      });
    const closed = yield* Effect.result(
      gh(
        ['pr', 'close', String(open.number), '--comment', `Moved to ${url}: the branch was renamed from ${upstream.branch} to ${to}.`],
        record.path,
      ),
    );
    return {
      status: 'moved',
      remote: upstream.remote,
      pullRequest: {
        opened: { number, url },
        closed: { number: open.number, url: open.url },
        closing: closed._tag === 'Success' ? null : said(closed.failure),
      },
      old: yield* dropped(record, upstream, to),
    };
  });

  const standing = Effect.fnUntraced(function* (projectId: number, rootId: RootId): Effect.fn.Return<WorktreeRecord, FinishFailure> {
    const record = yield* stored(units.read((unit) => records.byRoot(rootId, unit)));
    if (record === null || record.projectId !== projectId) {
      return yield* refused(
        'not-found',
        `no worktree Tagma made stands at ${rootId} in this project; main and checkouts Tagma did not make are not renamed here`,
        ["read this project's worktrees: list_worktrees"],
      );
    }
    return record;
  });

  const renamed = Effect.fnUntraced(function* (
    projectId: number,
    rootId: RootId,
    record: WorktreeRecord,
    from: string,
    to: string,
    remote: RenameRemote,
  ): Effect.fn.Return<WorktreeRenamed, FinishFailure> {
    const phase = (named: 'renaming' | 'pushing'): Effect.Effect<void> => progress?.phase(rootId, named) ?? Effect.void;
    const now = yield* standing(projectId, rootId);
    if (now.branch !== from) {
      return yield* refused('off-branch', `${record.name} moved from ${from} to ${now.branch ?? 'no branch'} while the rename waited`, [
        'read the worktree again, then rename it',
      ]);
    }
    const head = yield* asked(headAt(git, record.path));
    if (head.ref !== `${HEADS}${from}`) {
      return yield* refused(
        'off-branch',
        `the folder of ${record.name} no longer stands on ${from}${head.ref === null ? '' : `, it stands on ${head.ref.slice(HEADS.length)}`}`,
        [`check ${from} out again in ${record.path}, then rename`],
      );
    }
    if ((yield* asked(commitOf(git, record.path, `${HEADS}${to}`))) !== null) {
      return yield* refused('name-taken', `${to} already names a branch in this repository`, ['choose another name']);
    }
    const published = yield* asked(counterpart(record.path, from));
    if (published !== null && (yield* asked(commitOf(git, record.path, `refs/remotes/${published.upstream.remote}/${to}`))) !== null) {
      return yield* refused('name-taken', `${published.upstream.remote} already has a branch ${to}`, ['choose another name']);
    }
    yield* phase('renaming');
    const moved = yield* Effect.result(branches.move(record, from, to));
    if (moved._tag === 'Failure') {
      return moved.failure._tag === 'TwinFailed'
        ? yield* refused('git-refused', moved.failure.message, ['read what git said above and clear it, then rename again'])
        : yield* stored(Effect.fail(moved.failure));
    }
    if (!moved.success) {
      return yield* refused(
        'off-branch',
        `the record of ${record.name} moved off ${from} while it was renamed, so git's rename was undone`,
        ['read the worktree again, then rename it'],
      );
    }
    if (published !== null) yield* phase('pushing');
    const settled = published === null ? ({ status: 'unpublished' } as const) : yield* remoteOf(record, to, published.upstream, remote);
    if (published !== null) {
      yield* Effect.mapError(remember(record, to, published, settled), (failure) => {
        const refusal = gitFailed(failure);
        return new WorktreeFinishRefused({
          reason: refusal.reason,
          message: `${to} was renamed locally and its remote ${settled.status === 'moved' ? 'was moved' : 'kept its old branch'}, but the push destination could not be recorded: ${refusal.message}`,
          unblock: ['read the worktree again and repair its upstream before pushing'],
        });
      });
    }
    if (mark !== undefined) yield* mark(rootId);
    return { rootId, from, to, remote: settled };
  });

  const renaming = Effect.fnUntraced(function* (
    projectId: number,
    rootId: RootId,
    name: string,
    remote: RenameRemote,
  ): Effect.fn.Return<WorktreeRenamed, FinishFailure> {
    const record = yield* standing(projectId, rootId);
    const from = record.branch;
    if (from === null)
      return yield* refused('no-branch', `${record.name} stands on no branch to rename`, ['check out a branch in the worktree first']);
    const to = yield* spelled(record, name);
    if (to === from) return yield* refused('name-unchanged', `${record.name} is already on ${to}`, ['name a different branch']);
    return yield* gate(rootId, Effect.uninterruptible(renamed(projectId, rootId, record, from, to, remote)));
  });

  return WorktreeRenames.of({
    rename: Effect.fn('WorktreeRenames.rename')(function* (projectId, rootId, name, remote = 'keep') {
      const work = renaming(projectId, rootId, name, remote);
      return yield* progress === undefined ? work : progress.during(projectId, rootId, 'rename', work);
    }),
  });
});
