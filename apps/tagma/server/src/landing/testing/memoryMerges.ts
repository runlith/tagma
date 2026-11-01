import { Effect } from 'effect';
import type { MergeTree } from '@runlith/git/merge';
import { WorktreeFinishRefused } from '../../worktrees/contract/wire/failures.js';
import {
  MergeGit,
  type MergeCommit,
  type MergeInterruption,
  type MergeRemote,
  type MergePrepared,
  type MergeHookRefused,
} from '../contract/service/mergeGit.js';
import { NOTHING_CARRIED } from '../land/reshaping.js';

export type MemoryCommit = { readonly tree: string; readonly parents: readonly string[]; readonly message: string };
export type MemoryCheckout = {
  ref: string | null;
  detached: string | null;
  files: Record<string, string>;
  index: Record<string, string>;
  operation: string | null;
  interruption: MergeInterruption | null;
  sign: boolean;
  hook: MergePrepared | MergeHookRefused | null;
  remote: MergeRemote | null;
};

export const memoryMerges = () => {
  const trees = new Map<string, Readonly<Record<string, string>>>();
  const commits = new Map<string, MemoryCommit>();
  const refs = new Map<string, string>();
  const reflogs = new Map<string, Set<string>>();
  const checkouts = new Map<string, MemoryCheckout>();
  const comparisons = new Map<string, MergeTree>();
  const replays = new Map<string, string>();
  let serial = 0;
  const missing = (message: string) =>
    new WorktreeFinishRefused({ reason: 'git-unreadable', message, unblock: ['prepare the repository state'] });
  const checkoutAt = (path: string) =>
    Effect.suspend(() => {
      const found = checkouts.get(path);
      return found === undefined ? Effect.fail(missing(`no checkout ${path}`)) : Effect.succeed(found);
    });
  const commitAt = (commit: string) =>
    Effect.suspend(() => {
      const found = commits.get(commit);
      return found === undefined ? Effect.fail(missing(`no commit ${commit}`)) : Effect.succeed(found);
    });
  const treeAt = (id: string): Readonly<Record<string, string>> | undefined => trees.get(commits.get(id)?.tree ?? id);
  const readTree = (id: string) =>
    Effect.suspend(() => {
      const tree = treeAt(id);
      return tree === undefined ? Effect.fail(missing(`no tree ${id}`)) : Effect.succeed(tree);
    });
  const tree = (files: Readonly<Record<string, string>>): string => {
    const id = `tree:${JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))}`;
    trees.set(id, { ...files });
    return id;
  };
  const commit = (made: MergeCommit): string => {
    const id = `commit:${++serial}`;
    commits.set(id, { tree: made.tree, parents: [...made.parents], message: made.message });
    return id;
  };
  const reachable = (tip: string): Set<string> => {
    const seen = new Set<string>();
    const pending = [tip];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...(commits.get(next)?.parents ?? []));
    }
    return seen;
  };
  const changed = (from: Readonly<Record<string, string>>, to: Readonly<Record<string, string>>) =>
    [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((path) => from[path] !== to[path]).sort();
  const remembered = (ref: string, next: string) => {
    const before = refs.get(ref);
    const log = reflogs.get(ref) ?? new Set<string>();
    if (before !== undefined) log.add(before);
    log.add(next);
    reflogs.set(ref, log);
    refs.set(ref, next);
  };
  const place = (path: string, ref: string | null, head: string) => {
    if (ref !== null) remembered(ref, head);
    const files = treeAt(head) ?? {};
    checkouts.set(path, {
      ref,
      detached: ref === null ? head : null,
      files: { ...files },
      index: { ...files },
      operation: null,
      interruption: null,
      sign: false,
      hook: null,
      remote: null,
    });
  };
  const headOf = (checkout: MemoryCheckout) => (checkout.ref === null ? checkout.detached : (refs.get(checkout.ref) ?? null));
  const port = MergeGit.of({
    head: (path) => Effect.map(checkoutAt(path), (checkout) => ({ ref: checkout.ref, commit: headOf(checkout) })),
    resolve: (_path, ref) => Effect.succeed(refs.get(ref) ?? (commits.has(ref) ? ref : null)),
    tree: (_path, id) => Effect.map(commitAt(id), (made) => made.tree),
    ancestor: (_path, older, newer) => Effect.succeed(reachable(newer).has(older)),
    changed: Effect.fnUntraced(function* (_path, from, to, sinceFork) {
      let base = from;
      if (sinceFork) {
        const ours = reachable(from);
        const fork = [...reachable(to)].find((id) => ours.has(id));
        if (fork === undefined) return yield* missing(`no common ancestor of ${from} and ${to}`);
        base = fork;
      }
      return changed(yield* readTree(base), yield* readTree(to));
    }),
    operation: (path) => Effect.map(checkoutAt(path), (checkout) => checkout.operation),
    repository: (path) => Effect.as(checkoutAt(path), 'memory'),
    advance: (at) =>
      Effect.sync(() => {
        if (refs.get(at.ref) !== at.base) return false;
        remembered(at.ref, at.commit);
        return true;
      }),
    settle: Effect.fnUntraced(function* (at) {
      const checkout = checkouts.get(at.checkout);
      const before = treeAt(at.base);
      const after = treeAt(at.commit);
      const paths = before === undefined || after === undefined ? [] : changed(before, after);
      const stopped = (reason: string) => ({ unsynced: paths, reason });
      if (checkout === undefined || before === undefined || after === undefined)
        return stopped('the checkout or its trees could not be read');
      if (checkout.ref !== at.ref || refs.get(at.ref) !== at.commit)
        return stopped('the checkout no longer stands at the published commit');
      const dirty = paths.some(
        (path) => checkout.index[path] !== after[path] && (checkout.index[path] !== before[path] || checkout.files[path] !== before[path]),
      );
      if (dirty) return stopped('local changes would be overwritten');
      for (const path of paths) {
        if (checkout.index[path] === after[path]) continue;
        const value = after[path];
        if (value === undefined) {
          delete checkout.files[path];
          delete checkout.index[path];
        } else {
          checkout.files[path] = value;
          checkout.index[path] = value;
        }
      }
      return { unsynced: [], reason: null };
    }),
    proved: (_repository, _checkout, ref, id) =>
      Effect.succeed(reachable(refs.get(ref) ?? '').has(id) || (reflogs.get(ref)?.has(id) ?? false)),
    interrupted: (path) => Effect.map(checkoutAt(path), (checkout) => (checkout.operation === 'merge' ? checkout.interruption : null)),
    abort: (path) =>
      Effect.map(checkoutAt(path), (checkout) => {
        const files = treeAt(headOf(checkout) ?? '') ?? {};
        checkout.files = { ...files };
        checkout.index = { ...files };
        checkout.operation = null;
        checkout.interruption = null;
      }),
    take: Effect.fnUntraced(function* (at) {
      const checkout = yield* checkoutAt(at.checkout);
      if (checkout.ref !== `refs/heads/${at.branch}` || headOf(checkout) !== at.tip)
        return yield* new WorktreeFinishRefused({
          reason: 'finishing-busy',
          message: 'the source moved',
          unblock: ['prepare the repository state'],
        });
      const from = yield* readTree(at.tip);
      const to = yield* readTree(at.tree);
      if (changed(from, to).some((path) => checkout.files[path] !== from[path] || checkout.index[path] !== from[path]))
        return yield* new WorktreeFinishRefused({
          reason: 'source-dirty',
          message: 'local changes would be overwritten',
          unblock: ['prepare the repository state'],
        });
      const made = commit({
        tree: at.tree,
        parents: [at.tip, at.baseTip],
        message: `Merge ${at.baseBranch} into ${at.branch}\n`,
        sign: checkout.sign,
      });
      remembered(checkout.ref!, made);
      for (const path of changed(from, to)) {
        const value = to[path];
        if (value === undefined) {
          delete checkout.files[path];
          delete checkout.index[path];
        } else {
          checkout.files[path] = value;
          checkout.index[path] = value;
        }
      }
      return made;
    }),
    signing: (path) => Effect.map(checkoutAt(path), (checkout) => checkout.sign),
    hooks: Effect.fnUntraced(function* (path, _base, built, message) {
      const checkout = yield* checkoutAt(path);
      if (checkout.hook !== null && '_tag' in checkout.hook) return yield* checkout.hook;
      return checkout.hook ?? { tree: built, left: built, message, sign: checkout.sign };
    }),
    within: () => () => Effect.die('the memory merge adapter sets out no tree'),
    create: (_path, made) => Effect.sync(() => commit(made)),
    replay: Effect.fnUntraced(function* (_path, onto, tip) {
      const replayed = replays.get(`${onto}|${tip}`);
      if (replayed === undefined) return yield* missing(`the memory repository has no replay of ${tip} onto ${onto}`);
      return { head: replayed, tree: (yield* commitAt(replayed)).tree, conflicts: [] as const };
    }),
    posted: () => Effect.void,
    carry: (_project, _checkout, from, to) =>
      from === to ? Effect.succeed(NOTHING_CARRIED) : Effect.die('the memory repository has no prepared hook edits'),
    remote: (path) => Effect.map(checkoutAt(path), (checkout) => checkout.remote),
    push: () => Effect.die('the memory repository has no prepared remote publication'),
  });
  return {
    git: port,
    tree,
    commit,
    place,
    trees,
    commits,
    refs,
    checkouts,
    remembered,
    compare: (base: string, tip: string, result: MergeTree) => comparisons.set(`${base}|${tip}`, result),
    comparison: (base: string, tip: string) =>
      Effect.suspend(() => {
        const result = comparisons.get(`${base}|${tip}`);
        return result === undefined ? Effect.die(`no prepared comparison ${base}|${tip}`) : Effect.succeed(result);
      }),
    replayed: (onto: string, tip: string, head: string) => replays.set(`${onto}|${tip}`, head),
  };
};

export type MemoryMerges = ReturnType<typeof memoryMerges>;
