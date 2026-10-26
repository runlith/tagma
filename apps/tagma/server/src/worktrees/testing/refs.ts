import { Effect } from 'effect';
import { BranchRefRefused, BranchRefs, BranchRefsUnavailable, type BranchHead } from '../contract/service/refs.js';
import type { BranchCommit } from '../contract/wire/retirement.js';

export type MemoryBranchFacts = {
  readonly objects: ReadonlySet<string>;
  readonly changes: ReadonlyMap<string, readonly string[]>;
  readonly history: ReadonlyMap<string, readonly BranchCommit[]>;
};

export type MemoryBranchCheckout = {
  head: BranchHead;
  readonly refs: Map<string, string>;
  readonly tracking: Set<string>;
  readonly facts?: MemoryBranchFacts;
};

export const memoryBranchRefs = (checkouts: ReadonlyMap<string, MemoryBranchCheckout>): BranchRefs['Service'] => {
  const checkout = (path: string) => {
    const found = checkouts.get(path);
    return found === undefined
      ? Effect.fail(new BranchRefsUnavailable({ message: `no branch checkout at ${path}` }))
      : Effect.succeed(found);
  };
  return BranchRefs.of({
    head: (path) => Effect.map(checkout(path), (one) => ({ ...one.head })),
    commit: (path, ref) =>
      Effect.map(checkout(path), (one) =>
        ref === 'HEAD' ? one.head.commit : (one.refs.get(ref) ?? (ref === one.head.commit || one.facts?.objects.has(ref) ? ref : null)),
      ),
    published: (path, branch) =>
      Effect.map(
        checkout(path),
        (one) =>
          one.tracking.has(branch) ||
          [...one.refs.keys()].some(
            (ref) => ref.startsWith('refs/remotes/') && ref.slice(13).includes('/') && ref.slice(ref.indexOf('/', 13) + 1) === branch,
          ),
      ),
    rename: Effect.fnUntraced(function* (path, from, to) {
      const one = yield* checkout(path);
      const before = `refs/heads/${from}`;
      const after = `refs/heads/${to}`;
      const commit = one.refs.get(before);
      const collision = [...one.refs.keys()].some(
        (ref) => ref !== before && (ref === after || ref.startsWith(`${after}/`) || after.startsWith(`${ref}/`)),
      );
      if (commit === undefined || collision) {
        return yield* new BranchRefRefused({ message: `cannot rename ${from} to ${to}` });
      }
      one.refs.delete(before);
      one.refs.set(after, commit);
      for (const next of checkouts.values()) {
        if (next.refs === one.refs && next.head.ref === before) next.head = { ...next.head, ref: after };
      }
      if (one.tracking.delete(from)) one.tracking.add(to);
    }),
    changes: Effect.fnUntraced(function* (path, from, to) {
      const one = yield* checkout(path);
      const changes = one.facts?.changes.get(`${from}|${to}`);
      return changes === undefined ? yield* new BranchRefsUnavailable({ message: `no branch changes from ${from} to ${to}` }) : changes;
    }),
    commits: Effect.fnUntraced(function* (path, history) {
      const one = yield* checkout(path);
      const commits = one.facts?.history.get(`${history.base}|${history.tip}`);
      if (commits === undefined)
        return yield* new BranchRefsUnavailable({ message: `no branch history from ${history.base} to ${history.tip}` });
      const excluded = history.excludeSubject === undefined ? null : new RegExp(history.excludeSubject);
      return commits.filter((commit) => excluded === null || !excluded.test(commit.subject)).slice(0, history.limit);
    }),
    remove: Effect.fnUntraced(function* (path, branch) {
      const one = yield* checkout(path);
      const ref = `refs/heads/${branch}`;
      if (!one.refs.has(ref) || [...checkouts.values()].some((checkout) => checkout.refs === one.refs && checkout.head.ref === ref)) {
        return yield* new BranchRefRefused({ message: `cannot delete ${branch}` });
      }
      one.refs.delete(ref);
      one.tracking.delete(branch);
    }),
  });
};
