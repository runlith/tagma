import { existsSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { canon, ShadowGit, type ShadowMerge } from './shadow.js';
import { TreeMerges } from './merges.js';
import { stealthTreeName } from '../storage/layout.js';
import { FORMAT_FILE } from '../contract/wire/storage.js';
import { markerOf, markerStep, markerText, readMarker } from './marker.js';
import type { GraphSteps } from '../contract/service/steps.js';
import { OwnGitFailed } from '../../platform/git/ownGit.js';
import { type TreeCaptureFailed, treeBranch } from './batch.js';
import type { CopyFailure } from '../contract/wire/answers.js';
import { trackedLabel, trackingRef } from '../storage/tracking.js';

type Stranded = {
  readonly branch: string;
  readonly reason: string;
};

type BranchMerge = ShadowMerge & { readonly branch: string };

type RemoteTip = { readonly branch: string; readonly tip: string };

export type TopologySync = {
  readonly branch: string;
  readonly forkedFrom: string | null;
  readonly merges: readonly BranchMerge[];
  readonly pruned: readonly string[];
  readonly stranded: readonly Stranded[];
  readonly checkouts: readonly string[];
  readonly copyFailures?: readonly CopyFailure[];
  readonly blocked?: readonly string[];
  readonly remote?: RemoteTip;
};

const ALONE = 'main';

const lines = (out: string): string[] => (out === '' ? [] : out.split('\n'));

export type TreeHold = (treeRoot: string) => <A, E, R>(act: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export type TwinLevel = (twin: string) => Effect.Effect<string, { readonly message: string }>;

const levelled = (level: TwinLevel, twin: string): Effect.Effect<string> =>
  Effect.flatMap(Effect.result(level(twin)), (answer) =>
    answer._tag === 'Success'
      ? Effect.succeed(answer.success)
      : Effect.as(
          Effect.logWarning('an incoming graph branch could not be brought to this graph format, so it merges as it stands', {
            twin,
            reason: answer.failure.message,
          }),
          twin,
        ),
  );

export type TopologyMemory = {
  readonly absorbed: Map<string, string>;
  readonly remote: Map<string, string>;
  stranded: ReadonlySet<string>;
  checkouts: readonly string[] | null;
};

const remoteDue = (shadow: ShadowGit, treeRoot: string, memory: TopologyMemory, branch: string, tip: string | null): boolean =>
  tip !== null && memory.remote.get(branch) !== tip && !TreeMerges.standing(shadow, treeRoot);

const remoteTip = (shadow: ShadowGit, branch: string): Effect.Effect<string | null, OwnGitFailed> =>
  shadow.tracking === null
    ? Effect.succeed(null)
    : shadow.quiet('remote-tip', [
        '--git-dir',
        shadow.gitDir,
        'rev-parse',
        '--verify',
        '-q',
        `${trackingRef(shadow.tracking, branch)}^{commit}`,
      ]);

const markerAt = Effect.fnUntraced(function* (shadow: ShadowGit, commit: string) {
  const marked = yield* shadow.run('their-marker', ['--git-dir', shadow.gitDir, 'ls-tree', '--name-only', commit, '--', FORMAT_FILE]);
  return marked === ''
    ? null
    : markerStep(markerOf(yield* shadow.run('their-marker', ['--git-dir', shadow.gitDir, 'show', `${commit}:${FORMAT_FILE}`])));
});

const olderThanBase = (steps: GraphSteps['Service'], brought: string | null): string | null =>
  steps.base !== null && steps.standing(brought) === 'older'
    ? `its graph stands at form ${brought ?? '(none)'}, older than ${steps.base.step}; opening that branch once with Tagma ${steps.base.release} brings it forward`
    : null;

const lowerMarker = Effect.fnUntraced(function* (
  steps: GraphSteps['Service'],
  markerPath: string,
  brought: string | null,
  reached: string | null,
) {
  const lower = steps.lower(brought, reached);
  if (lower === undefined || markerStep(yield* readMarker(markerPath)) === lower) return reached;
  writeFileSync(markerPath, markerText(lower));
  return lower;
});

type RemoteAbsorbed = {
  readonly merge: BranchMerge | null;
  readonly stranded: Stranded | null;
  readonly remote: RemoteTip | undefined;
  readonly reached: string | null;
};

const absorbRemote = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  treeRoot: string,
  branch: string,
  recovery: TreeMerges,
  steps: GraphSteps['Service'],
  level: TwinLevel | undefined,
  reached: string | null,
): Effect.fn.Return<RemoteAbsorbed, OwnGitFailed> {
  const tracking = shadow.tracking;
  const tip = yield* remoteTip(shadow, branch);
  if (tracking === null || tip === null) return { merge: null, stranded: null, remote: undefined, reached };
  const seen = { merge: null, stranded: null, remote: { branch, tip }, reached };
  const head = yield* shadow.run('remote-head', ['-C', treeRoot, 'rev-parse', 'HEAD']);
  if (head === tip) return seen;
  const base = yield* shadow.quiet('remote-base', ['--git-dir', shadow.gitDir, 'merge-base', head, tip]);
  if (base === null || base === tip) return seen;
  const label = trackedLabel(tracking, branch);
  const carried = base === head || level === undefined ? tip : yield* levelled(level, tip);
  const brought = yield* markerAt(shadow, carried);
  const older = olderThanBase(steps, brought);
  if (older !== null) return { ...seen, stranded: { branch: label, reason: older } };
  if (base === head) {
    yield* shadow.run('remote-forward', ['-C', treeRoot, 'merge', '--ff-only', '--no-edit', tip]);
    return { ...seen, merge: { branch: label, merged: tip, conflicts: [] }, reached: brought };
  }
  const outcome = yield* recovery.merge(trackingRef(tracking, branch), carried);
  if (outcome.merged === null) return { merge: { ...outcome, branch: label }, stranded: null, remote: undefined, reached };
  return {
    ...seen,
    merge: { ...outcome, branch: label },
    reached: yield* lowerMarker(steps, join(treeRoot, FORMAT_FILE), brought, reached),
  };
});

export type TopologyReading = {
  readonly branch: string | null;
  readonly head: string | null;
  readonly due: boolean;
  readonly merged: ReadonlyMap<string, string>;
};

export const readTopology = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  projectWorktree: string,
  treeRoot: string,
  memory: TopologyMemory,
): Effect.fn.Return<TopologyReading, OwnGitFailed | TreeCaptureFailed> {
  const project = yield* treeBranch(projectWorktree);
  if ('held' in project && project.held === 'no-repository') {
    const tip = yield* remoteTip(shadow, ALONE);
    return { branch: null, head: null, due: remoteDue(shadow, treeRoot, memory, ALONE, tip), merged: new Map() };
  }
  const refs = lines(
    yield* shadow.run('topology-refs', [
      '-C',
      projectWorktree,
      'for-each-ref',
      '--format=%(HEAD)%00%(refname:short)%00%(objectname)',
      'refs/heads',
    ]),
  ).map((line) => line.split('\0') as [string, string, string]);
  const current = refs.find(([mark]) => mark === '*');
  if (current === undefined) {
    if (!('ref' in project)) return { branch: null, head: null, due: true, merged: new Map() };
    const unborn = project.ref.replace(/^refs\/heads\//, '');
    const tip = yield* remoteTip(shadow, unborn);
    return { branch: null, head: null, due: remoteDue(shadow, treeRoot, memory, unborn, tip), merged: new Map() };
  }
  const [, branch, head] = current;
  const tips = new Map(refs.map(([, name, tip]) => [name, tip] as const));
  const twins = new Set<string>();
  let remote: string | null = null;
  const tracked = shadow.tracking === null ? null : trackingRef(shadow.tracking, branch);
  for (const line of lines(
    yield* shadow.run('shadow-branches', [
      '--git-dir',
      shadow.gitDir,
      'for-each-ref',
      '--format=%(refname)%00%(objectname)',
      'refs/heads',
      ...(tracked === null ? [] : [tracked]),
    ]),
  )) {
    const [ref = '', tip = ''] = line.split('\0');
    if (ref.startsWith('refs/heads/')) twins.add(ref.slice('refs/heads/'.length));
    else if (ref === tracked) remote = tip;
  }
  const standing = yield* treeBranch(treeRoot);
  const merged = new Map<string, string>();
  const reading = (due: boolean): TopologyReading => ({
    branch,
    head,
    due,
    merged,
  });
  if (!twins.has(branch) || !('ref' in standing) || standing.ref !== `refs/heads/${branch}`) return reading(true);
  if (remoteDue(shadow, treeRoot, memory, branch, remote)) return reading(true);
  if ([...twins].some((name) => name !== branch && !tips.has(name) && !memory.stranded.has(name))) return reading(true);
  if (memory.checkouts === null) return reading(true);
  if (memory.checkouts.some((checkout) => checkout !== projectWorktree)) {
    const live = new Set(yield* shadow.checkouts(projectWorktree));
    if (memory.checkouts.some((checkout) => !live.has(checkout))) return reading(true);
  }
  const forks = yield* shadow.forkPoints();
  if (![...tips].some(([name, tip]) => name !== branch && twins.has(name) && tip !== head && tip !== forks.get(name)))
    return reading(false);
  const reached = new Set(
    lines(
      yield* shadow.run('topology-merged', [
        '-C',
        projectWorktree,
        'for-each-ref',
        '--merged',
        'HEAD',
        '--format=%(refname:short)',
        'refs/heads',
      ]),
    ),
  );
  for (const [name, tip] of tips) {
    if (name === branch || !twins.has(name) || !reached.has(name) || tip === head || tip === forks.get(name)) continue;
    merged.set(name, tip);
  }
  return reading([...merged].some(([name, tip]) => memory.absorbed.get(name) !== tip));
});

export const rememberTopology = (memory: TopologyMemory, reading: TopologyReading, synced: TopologySync): void => {
  let interrupted = false;
  const completed = new Set<string>();
  for (const merge of synced.merges) {
    if (merge.merged === null) interrupted = true;
    else completed.add(merge.branch);
  }
  const held = new Set(synced.blocked ?? []);
  for (const [name, tip] of reading.merged) {
    if (held.has(name)) continue;
    if (!interrupted || completed.has(name)) memory.absorbed.set(name, tip);
  }
  memory.stranded = new Set(synced.stranded.map((one) => one.branch));
  memory.checkouts = synced.checkouts;
  if (synced.remote !== undefined) memory.remote.set(synced.remote.branch, synced.remote.tip);
};

type BaseCandidate = {
  readonly own: boolean;
  readonly holds: number;
  readonly shadowDepth: number;
};

const preferred = (one: BaseCandidate, best: BaseCandidate): boolean => {
  if (one.own !== best.own) return one.own;
  if (one.holds !== best.holds) return one.holds > best.holds;
  return one.shadowDepth < best.shadowDepth;
};

const baseOf = Effect.fnUntraced(function* (shadow: ShadowGit, projectWorktree: string, branch: string, candidates: readonly string[]) {
  const measured = yield* Effect.forEach(candidates, (name) =>
    Effect.gen(function* () {
      const base = yield* shadow.run('merge-base', ['-C', projectWorktree, 'merge-base', branch, name]);
      const depth = Number(yield* shadow.run('depth', ['-C', projectWorktree, 'rev-list', '--count', base]));
      return { name, base, depth };
    }),
  );
  const deepest = Math.max(...measured.map((one) => one.depth));
  const group = new Set(measured.filter((one) => one.depth === deepest).map((one) => one.name));
  const forks = yield* shadow.forkPoints();
  let best: {
    readonly name: string;
    readonly own: boolean;
    readonly holds: number;
    readonly shadowDepth: number;
  } | null = null;
  for (const { name, base } of measured) {
    if (!group.has(name)) continue;
    const line = lines(
      yield* shadow.run('first-parent', ['-C', projectWorktree, 'rev-list', '--first-parent', '--parents', name, `^${base}`]),
    ).map((entry) => entry.split(' '));
    const fork = forks.get(name);
    const onLine = line.length === 0 || line[line.length - 1]![1] === base;
    const own = onLine && fork !== base && !line.some(([commit]) => commit === fork);
    const held = lines(
      yield* shadow.run('twin-holds', [
        '--git-dir',
        shadow.gitDir,
        'for-each-ref',
        '--merged',
        name,
        '--format=%(refname:short)',
        'refs/heads',
      ]),
    );
    const holds = held.filter((other) => other !== name && group.has(other)).length;
    const shadowDepth = Number(yield* shadow.run('shadow-depth', ['--git-dir', shadow.gitDir, 'rev-list', '--count', name]));
    const one = { name, own, holds, shadowDepth };
    if (best === null || preferred(one, best)) best = one;
  }
  return best?.name ?? null;
});

const retireTrees = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  treeRoot: string,
  checkouts: readonly [string, ...string[]],
  named: readonly string[],
  hold: TreeHold,
) {
  const home = yield* canon(dirname(treeRoot));
  const own = yield* canon(treeRoot);
  const live = new Set(yield* Effect.forEach(checkouts, canon));
  const unrecorded = new Set(yield* Effect.forEach(named, canon));
  const left = new Map<string, string>();
  for (const name of yield* Effect.promise(() =>
    readdir(home).catch((cause: NodeJS.ErrnoException) => (cause.code === 'ENOENT' ? [] : Promise.reject(cause))),
  )) {
    const path = yield* canon(join(home, name));
    if (dirname(path) !== home || path === own || !(yield* shadow.belongsTo(path, checkouts[0]))) continue;
    const served = yield* shadow.servedCheckout(path);
    if (!(served === null ? unrecorded.has(path) : live.has(served))) left.set(path, join(dirname(treeRoot), name));
  }
  if (left.size === 0) return false;
  const merging = yield* TreeMerges.mergingTrees(shadow);
  let removed = false;
  for (const [physical, path] of left) {
    if (merging.has(physical)) continue;
    const retired = yield* Effect.result(
      hold(path)(
        Effect.gen(function* () {
          const state = yield* shadow.run('tree-state', ['-C', path, 'status', '--porcelain', '--untracked-files=all', '--ignored']);
          if (state !== '') return false;
          yield* shadow.retire(path);
          return true;
        }),
      ),
    );
    if (retired._tag === 'Failure') {
      yield* Effect.logWarning('a graph tree whose checkout left its repository stays, because git would not remove it', {
        tree: path,
        reason: retired.failure.message,
      });
    } else if (retired.success) removed = true;
  }
  return removed;
});

type TopologyOptions = {
  readonly absorb?: boolean;
  readonly blocked?: ReadonlySet<string>;
  readonly treeHold?: TreeHold;
  readonly retired?: Effect.Effect<void>;
  readonly level?: TwinLevel;
};

const alone = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  projectWorktree: string,
  treeRoot: string,
  steps: GraphSteps['Service'],
  recovery: TreeMerges,
  options: TopologyOptions,
): Effect.fn.Return<TopologySync, OwnGitFailed> {
  if (!existsSync(`${treeRoot}/.git`)) yield* shadow.attach(treeRoot, ALONE);
  const pending = yield* recovery.read();
  const merges: BranchMerge[] = pending === null ? [] : [{ branch: pending.incoming, merged: null, conflicts: pending.conflicts }];
  const stranded: Stranded[] = [];
  let remote: RemoteTip | undefined;
  if (pending === null && options.absorb !== false) {
    const reached = markerStep(yield* readMarker(join(treeRoot, FORMAT_FILE)));
    const absorbed = yield* absorbRemote(shadow, treeRoot, ALONE, recovery, steps, options.level, reached);
    if (absorbed.merge !== null) merges.push(absorbed.merge);
    if (absorbed.stranded !== null) stranded.push(absorbed.stranded);
    remote = absorbed.remote;
  }
  return {
    branch: ALONE,
    forkedFrom: null,
    merges,
    pruned: [],
    stranded,
    checkouts: [projectWorktree],
    blocked: [...(options.blocked ?? [])],
    remote,
  };
});

export const syncTopology = Effect.fnUntraced(function* (
  shadow: ShadowGit,
  projectWorktree: string,
  treeRoot: string,
  steps: GraphSteps['Service'],
  options: TopologyOptions = {},
): Effect.fn.Return<TopologySync, OwnGitFailed> {
  const recovery = TreeMerges.at(shadow, treeRoot);
  yield* recovery.restore();
  const standing = yield* treeBranch(projectWorktree, { operations: false }).pipe(
    Effect.mapError((failure) => new OwnGitFailed({ op: 'topology', message: failure.message, ran: false })),
  );
  if ('held' in standing && standing.held === 'no-repository')
    return yield* alone(shadow, projectWorktree, treeRoot, steps, recovery, options);
  if (!('ref' in standing)) {
    return yield* new OwnGitFailed({
      op: 'topology',
      message: `${projectWorktree} stands on a detached HEAD, not a branch`,
      ran: true,
    });
  }
  const branch = standing.ref.replace(/^refs\/heads\//, '');
  const tips = new Map(
    lines(
      yield* shadow.run('branches', ['-C', projectWorktree, 'for-each-ref', 'refs/heads', '--format=%(refname:short)%00%(objectname)']),
    ).map((line) => line.split('\0') as [string, string]),
  );
  const born = tips.has(branch);
  const projectBranches = [...tips.keys()];
  const twins = lines(
    yield* shadow.run('shadow-branches', ['--git-dir', shadow.gitDir, 'for-each-ref', 'refs/heads', '--format=%(refname:short)']),
  );
  const shadowBranches = twins.filter((name) => !options.blocked?.has(name));
  if (shadowBranches.length === 0)
    return yield* new OwnGitFailed({
      op: 'topology',
      message: 'Every graph branch is blocked from this synchronization',
      ran: false,
    });
  let forkedFrom: string | null = null;
  if (!shadowBranches.includes(branch)) {
    const tracked = yield* remoteTip(shadow, branch);
    const shared =
      tracked !== null &&
      (yield* shadow.quiet('remote-shared', ['--git-dir', shadow.gitDir, 'merge-base', tracked, `refs/heads/${shadowBranches[0]}`])) !==
        null;
    if (tracked !== null && shared && shadow.tracking !== null) {
      forkedFrom = trackedLabel(shadow.tracking, branch);
      yield* shadow.branch(branch, tracked);
    } else {
      const candidates = shadowBranches.filter((name) => projectBranches.includes(name));
      forkedFrom = (yield* baseOf(shadow, projectWorktree, branch, candidates)) ?? shadowBranches[0] ?? 'main';
      yield* shadow.branch(branch, forkedFrom);
    }
    if (born) {
      const logged = lines(
        yield* shadow.run('fork-log', ['-C', projectWorktree, 'reflog', 'show', '--format=%H', `refs/heads/${branch}`, '--']),
      );
      const cut = logged.at(-1) ?? (yield* shadow.run('fork-sha', ['-C', projectWorktree, 'rev-parse', branch]));
      yield* shadow.recordFork(branch, cut);
    }
  }
  const checkouts = yield* shadow.checkouts(projectWorktree);
  const siblings = checkouts.map((checkout) => join(dirname(treeRoot), stealthTreeName(checkout)));
  const freed = shadow.free(branch, siblings, checkouts[0]);
  if (existsSync(`${treeRoot}/.git`)) {
    const standing = yield* shadow.run('standing', ['-C', treeRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (standing !== branch) {
      yield* freed;
      yield* shadow.run('switch', ['-C', treeRoot, 'switch', branch]);
    }
  } else {
    const held = yield* freed;
    yield* shadow.attach(treeRoot, branch, held === 'unheld' ? { unheld: true } : undefined);
  }
  yield* shadow.recordCheckout(treeRoot, checkouts[0], projectWorktree);
  const headSha = born ? (tips.get(branch) ?? null) : null;
  const forks = yield* shadow.forkPoints();
  yield* TreeMerges.retireGone(shadow, checkouts[0], [...projectBranches, branch], twins);
  const pending = yield* recovery.read();
  const merges: (ShadowMerge & { branch: string })[] =
    pending === null
      ? []
      : [
          {
            branch: pending.incoming,
            merged: null,
            conflicts: pending.conflicts,
          },
        ];
  const stranded: { branch: string; reason: string }[] = [];
  const markerPath = join(treeRoot, FORMAT_FILE);
  let reached = markerStep(yield* readMarker(markerPath));
  const absorbing = headSha !== null && options.absorb !== false && pending === null;
  const contained = absorbing
    ? new Set(
        lines(
          yield* shadow.run('merged', [
            '-C',
            projectWorktree,
            'for-each-ref',
            '--merged',
            'HEAD',
            '--format=%(refname:short)',
            'refs/heads',
          ]),
        ),
      )
    : new Set<string>();
  for (const name of absorbing ? projectBranches : []) {
    if (name === branch || !shadowBranches.includes(name) || !contained.has(name)) continue;
    const tip = tips.get(name);
    if (tip === headSha || tip === forks.get(name)) continue;
    const behind = yield* shadow.run('behind', ['--git-dir', shadow.gitDir, 'rev-list', '--count', `${branch}..${name}`]);
    if (behind === '0') continue;
    const carried = options.level === undefined ? name : yield* levelled(options.level, name);
    const brought = yield* markerAt(shadow, carried);
    const older = olderThanBase(steps, brought);
    if (older !== null) {
      stranded.push({ branch: name, reason: older });
      continue;
    }
    const outcome = yield* recovery.merge(name, carried);
    merges.push({ ...outcome, branch: name });
    if (outcome.merged === null) continue;
    reached = yield* lowerMarker(steps, markerPath, brought, reached);
  }
  let remote: RemoteTip | undefined;
  if (options.absorb !== false && pending === null && !merges.some((merge) => merge.merged === null)) {
    const absorbed = yield* absorbRemote(shadow, treeRoot, branch, recovery, steps, options.level, reached);
    if (absorbed.merge !== null) merges.push(absorbed.merge);
    if (absorbed.stranded !== null) stranded.push(absorbed.stranded);
    remote = absorbed.remote;
  }
  if (options.treeHold !== undefined && (yield* retireTrees(shadow, treeRoot, checkouts, siblings, options.treeHold)))
    yield* options.retired ?? Effect.void;
  const pruned: string[] = [];
  const kept = new Set([...projectBranches, branch]);
  for (const name of shadowBranches) {
    if (kept.has(name)) continue;
    const holders = lines(
      yield* shadow.run('holders', [
        '--git-dir',
        shadow.gitDir,
        'for-each-ref',
        '--contains',
        name,
        '--format=%(refname:short)',
        'refs/heads',
      ]),
    );
    if (!holders.some((holder) => holder !== name && kept.has(holder))) {
      stranded.push({
        branch: name,
        reason: 'its graph commits reached no branch the repository keeps',
      });
      continue;
    }
    const gone = yield* Effect.result(shadow.run('prune', ['--git-dir', shadow.gitDir, 'branch', '-D', name]));
    if (gone._tag === 'Success') {
      pruned.push(name);
      yield* options.retired ?? Effect.void;
      yield* shadow.dropFork(name);
    } else {
      stranded.push({ branch: name, reason: gone.failure.message });
    }
  }
  return {
    branch,
    forkedFrom,
    merges,
    pruned,
    stranded,
    checkouts,
    blocked: [...(options.blocked ?? [])],
    remote,
  };
});
