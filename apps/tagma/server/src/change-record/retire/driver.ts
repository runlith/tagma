import { Cause, Effect, Exit, Scope, Semaphore, Stream } from 'effect';
import type { LineHunk } from '@runlith/files/hunk';
import { Git } from '@runlith/git/Git';
import { runGit } from '../../platform/git/ownGit.js';
import { CheckoutRows } from '../../workspace/contract/service/checkouts.js';
import { FileRoots } from '../../workspace/contract/service/roots.js';
import { RootId } from '../../workspace/contract/wire/ids.js';
import type { FileRoot } from '../../workspace/contract/wire/roots.js';
import { OPERATOR, holderKey } from '../../workspace/contract/wire/checkout.js';
import { HeldFeed } from '../contract/service/held.js';
import { Holdings, type IntroducedStep } from '../contract/service/holdings.js';
import { type RetireFailure, type Retired, Retirement } from '../contract/service/retirement.js';

import type { ReleasedSpan } from '../lines/released.js';
import type { Walks } from '../lines/walks.js';
import { commonBase, historySince, unreached, type SeenHistory } from './history.js';
import { type Leaving, makeRetireStore, type Proof, type StandingRow, type Withdrawal } from './store.js';
import type { CommandWrites } from '../record/commands.js';
import { makeDebts } from './debts.js';
import { makePasses } from './passes.js';
import type { Background } from '../../platform/contract/service/background.js';

const NOTHING: Retired = { committed: [], withdrawn: [] };

const OPERATOR_KEY = holderKey(OPERATOR);

const byPath = (rows: readonly StandingRow[]): Map<string, StandingRow[]> => {
  const paths = new Map<string, StandingRow[]>();
  for (const row of rows) {
    const standing = paths.get(row.path);
    if (standing === undefined) paths.set(row.path, [row]);
    else standing.push(row);
  }
  return paths;
};

type Place = { readonly removed: false; readonly root: FileRoot } | { readonly removed: true };

export type Retirer = Effect.Success<ReturnType<typeof makeRetirer>>;

export const makeRetirer = Effect.fnUntraced(function* ({
  walks,
  commands,
  background,
}: {
  readonly walks: Walks;
  readonly commands: CommandWrites;
  readonly background: Background['Service'];
}) {
  const store = yield* makeRetireStore;
  const holdings = yield* Holdings;
  const roots = yield* FileRoots;
  const checkouts = yield* CheckoutRows;
  const git = yield* Git;
  const held = yield* HeldFeed;
  const debts = yield* makeDebts({ store, commands });
  const scope = yield* Effect.scope;
  const followed = new Map<string, Scope.Closeable>();
  const claiming = yield* Semaphore.make(1);
  let listening = false;

  const placed = (checkout: RootId): Effect.Effect<Place, RetireFailure> =>
    Effect.catch(
      Effect.map(roots.read(checkout), (root): Place => ({ removed: false, root })),
      (failure) =>
        Effect.flatMap(roots.removed(checkout), (removed): Effect.Effect<Place, RetireFailure> =>
          removed ? Effect.succeed({ removed: true }) : Effect.fail(failure),
        ),
    );

  const told = Effect.fnUntraced(function* (rows: readonly StandingRow[], outcomes = false) {
    const groups = new Map<string, StandingRow[]>();
    for (const row of rows) {
      const key = `${row.projectId}\0${row.holder}\0${row.checkout}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const group of groups.values()) {
      const first = group[0] as StandingRow;
      yield* held.publish({
        threadId: first.holder === OPERATOR_KEY ? null : first.holder,
        outcomes,
        moved: { projectId: first.projectId, places: group.map((row) => ({ checkout: row.checkout, path: row.path })) },
      });
    }
  });

  const left = Effect.fn('Retirer.leave')(function* (decisions: readonly Leaving[], guarded: boolean) {
    if (decisions.length === 0) return NOTHING;
    const rows = yield* store.leave(decisions, guarded);
    yield* told(rows);
    return {
      committed: rows.filter((row) => row.state === 'committed').map((row) => row.id),
      withdrawn: rows.filter((row) => row.state === 'withdrawn').map((row) => row.id),
    };
  });

  const withdrawals = Effect.fnUntraced(function* (rows: readonly StandingRow[], reason: Withdrawal) {
    if (rows.length === 0) return [];
    const recorded = yield* store.hunks(rows);
    const hunks = rows.map((row) => recorded.get(row.id) ?? null);
    const known = hunks.filter((hunk): hunk is LineHunk => hunk !== null);
    const spans = yield* Effect.result(walks.spans(known));
    const found = new Map<number, ReleasedSpan>();
    if (spans._tag === 'Success') {
      let next = 0;
      for (const [at, hunk] of hunks.entries()) if (hunk !== null) found.set(at, spans.success[next++] as ReleasedSpan);
    } else yield* Effect.logWarning('released lines keep no witness: their spans could not be measured', { reason: spans.failure.reason });
    return rows.map((row, at): Leaving => ({
      id: row.id,
      after: row.afterHash,
      state: 'withdrawn',
      reason,
      span: found.get(at) ?? null,
    }));
  });

  const unfollowed = (checkout: RootId, rows: readonly StandingRow[]): Effect.Effect<Retired> =>
    Effect.suspend(() => {
      if (rows.length > 0) return Effect.succeed(NOTHING);
      const watching = followed.get(checkout);
      if (watching === undefined) return Effect.succeed(NOTHING);
      followed.delete(checkout);
      return Effect.as(Scope.close(watching, Exit.void), NOTHING);
    });

  const vacate = Effect.fnUntraced(function* (checkout: RootId) {
    const rows = yield* store.standing(checkout);
    const gone = yield* left(
      rows.flatMap((row): Leaving[] =>
        row.state === 'held' ? [{ id: row.id, state: 'withdrawn', reason: 'checkout-gone', span: null }] : [],
      ),
      false,
    );
    yield* store.vacate(checkout);
    yield* unfollowed(checkout, []);
    return gone;
  });

  const exists = (dir: string, commit: string) =>
    Effect.map(
      runGit(git, 'retire-seen', ['-C', dir, 'cat-file', '--batch-check'], { stdin: `${commit}\n` }),
      (answer) => answer.split(' ')[1] === 'commit',
    );

  const lowerBound = Effect.fnUntraced(function* (checkout: RootId, dir: string, head: string, rows: readonly StandingRow[]) {
    const seen = yield* store.seen(checkout);
    if (seen !== null && (seen === head || (yield* exists(dir, seen)))) return { from: seen, seen };
    const heads = [...new Set(rows.flatMap((row) => (row.head === null ? [] : [row.head])))];
    yield* store.headless(checkout, head);
    if (heads.length === 0) return { from: head, seen };
    const base = yield* Effect.result(commonBase(git, dir, heads));
    if (base._tag === 'Failure') {
      yield* Effect.logWarning('the retirement pass reads no history before HEAD: the common base of its rows could not be read', {
        checkout,
        reason: base.failure.message,
      });
      return { from: head, seen };
    }
    return { from: base.success === '' ? head : base.success, seen };
  });

  const valid = Effect.fnUntraced(function* (
    checkout: RootId,
    dir: string,
    head: string,
    seen: string | null,
    history: SeenHistory | null,
    rows: readonly StandingRow[],
  ) {
    const proofs = yield* store.proofs(checkout);
    if (proofs.length === 0) return new Set<string>();
    const live = new Map(rows.filter((row) => row.state === 'held').map((row) => [row.id, row] as const));
    const linked = seen !== null && (seen === head || history?.ancestors(head).has(seen) === true);
    const unlinked = linked
      ? new Set<string>()
      : yield* unreached(
          git,
          dir,
          head,
          proofs.map((proof) => proof.commit),
        );
    const kept = new Set<string>();
    const invalid: string[] = [];
    for (const proof of proofs) {
      const row = live.get(proof.row);
      if (row === undefined || row.afterHash !== proof.after || unlinked.has(proof.commit)) invalid.push(proof.row);
      else kept.add(proof.row);
    }
    if (invalid.length > 0) yield* store.forget(invalid);
    return kept;
  });

  const walked = Effect.fn('Retirer.history')(function* (
    checkout: RootId,
    head: string,
    history: SeenHistory,
    rows: readonly StandingRow[],
    queued: ReadonlySet<string>,
  ) {
    const paths = byPath(rows.filter((row) => !queued.has(row.id)));
    const trees = yield* store.trees(
      checkout,
      history.commits.map((one) => one.commit),
    );
    const gone = new Set(queued);
    const touched = new Map<string, string>();
    const steps: IntroducedStep[] = [];
    for (const one of history.commits) {
      for (const path of one.paths) touched.set(path, one.commit);
      const asked = one.paths.filter((path) => paths.has(path));
      if (asked.length === 0) continue;
      steps.push({
        commit: one.commit,
        tree: trees.get(one.commit) ?? null,
        paths: new Map(asked.map((path) => [path, one.sides.get(path)!] as const)),
      });
    }
    const remaining = yield* holdings.judged(checkout, [...new Set(steps.flatMap((step) => [...step.paths.keys()]))]);
    const proofs: Proof[] = [];
    const overwritten: { readonly row: StandingRow; readonly commit: string }[] = [];
    let moved = false;
    yield* holdings.introduced(checkout, steps, (step, verdicts) =>
      Effect.sync(() => {
        const leaving = new Set<string>();
        for (const [path, verdict] of verdicts) {
          if (verdict.verdict !== 'proven') continue;
          const live = new Map(
            (paths.get(path) ?? []).filter((row) => !gone.has(row.id) && row.state === 'held').map((row) => [row.id, row] as const),
          );
          const current = remaining.get(path);
          if (current !== undefined && current.head !== head && live.size > 0) moved = true;
          if (current === undefined || current.head !== head || current.verdict.verdict !== 'proven') continue;
          const carried = new Set<string>();
          for (const id of verdict.standing) {
            if (current.verdict.standing.has(id)) continue;
            const row = live.get(id);
            if (row === undefined) continue;
            if (row.head !== null && history.ancestors(row.head).has(step.commit)) continue;
            carried.add(id);
          }
          for (const id of carried) {
            const row = live.get(id)!;
            proofs.push({
              row: id,
              checkout,
              path: row.path,
              after: row.afterHash,
              reason: 'committed',
              commit: step.commit,
              span: null,
            });
            leaving.add(id);
          }
          for (const [id, by] of verdict.overwritten) {
            if (current.verdict.standing.has(id)) continue;
            const row = live.get(id);
            if (row === undefined || carried.has(id)) continue;
            if (by.length > 0 && by.every((other) => carried.has(other) || gone.has(other))) {
              overwritten.push({ row, commit: step.commit });
              leaving.add(id);
            }
          }
        }
        for (const id of leaving) gone.add(id);
        return leaving;
      }),
    );
    const decided = yield* withdrawals(
      overwritten.map((one) => one.row),
      'overwritten',
    );
    for (const [at, decision] of decided.entries()) {
      if (decision.state !== 'withdrawn') continue;
      const { row, commit } = overwritten[at]!;
      proofs.push({ row: row.id, checkout, path: row.path, after: row.afterHash, reason: 'overwritten', commit, span: decision.span });
    }
    if (moved) return null;
    yield* store.advance(checkout, head, touched, [], proofs);
    const known = new Set(proofs.filter((proof) => proof.reason === 'committed').map((proof) => proof.row));
    yield* told(
      rows.filter((row) => known.has(row.id)),
      true,
    );
    return touched;
  });

  const revertible = Effect.fnUntraced(function* (
    checkout: RootId,
    head: string,
    paths: ReadonlyMap<string, readonly StandingRow[]>,
    gone: ReadonlySet<string>,
    touched: ReadonlyMap<string, string>,
  ) {
    const standing = [...paths].flatMap(([path, rows]) => (rows.some((row) => !gone.has(row.id)) ? [path] : []));
    if (standing.length === 0) return [];
    const shown = new Map((yield* holdings.read(checkout)).paths.map((one) => [one.path, one.git] as const));
    const asked = standing.filter((path) => {
      if (touched.has(path) || !shown.has(path)) return true;
      const git = shown.get(path);
      return git === null || git === 'ignored';
    });
    if (asked.length === 0) return [];
    const judged = yield* holdings.judged(checkout, asked);
    const archived = yield* store.archived(asked.flatMap((path) => paths.get(path) ?? []));
    const leaving: Leaving[] = [];
    for (const [path, one] of judged) {
      const live = (paths.get(path) ?? []).filter((row) => !gone.has(row.id) && row.state === 'held');
      if (one.holding.git === 'ignored') {
        for (const row of live)
          if (archived.has(row.holder))
            leaving.push({ id: row.id, after: row.afterHash, state: 'withdrawn', reason: 'outside', span: null });
        continue;
      }
      if (one.head !== head || one.holding.git !== null) continue;
      const atHead = one.digests !== null && one.digests.head !== undefined && one.digests.head === one.digests.working;
      const standing = one.verdict.verdict === 'proven' ? one.verdict.standing : atHead ? new Set<string>() : null;
      if (standing === null) continue;
      for (const row of live)
        if (!standing.has(row.id)) leaving.push({ id: row.id, after: row.afterHash, state: 'withdrawn', reason: 'reverted', span: null });
    }
    return leaving;
  });

  const passed = Effect.fnUntraced(function* (checkout: RootId, root: FileRoot) {
    const dir = root.path;
    const head = yield* runGit(git, 'retire-head', ['-C', dir, 'rev-parse', '--verify', 'HEAD^{commit}']);
    const rows = yield* store.standing(checkout);
    const { from, seen } = yield* lowerBound(checkout, dir, head, rows);
    const history =
      from === head
        ? null
        : yield* historySince(
            git,
            dir,
            from,
            head,
            rows.flatMap((row) => (row.head === null ? [] : [row.head])),
          );
    const queued = yield* valid(checkout, dir, head, seen, history, rows);
    const touched = history === null ? new Map<string, string>() : yield* walked(checkout, head, history, rows, queued);
    if (touched === null) return NOTHING;
    if (history === null) yield* store.advance(checkout, head, touched, []);
    const proofs = yield* store.proofs(checkout);
    const done = yield* left(
      proofs.map((proof): Leaving =>
        proof.reason === 'committed'
          ? { id: proof.row, after: proof.after, state: 'committed', commit: proof.commit }
          : { id: proof.row, after: proof.after, state: 'withdrawn', reason: 'overwritten', span: proof.span },
      ),
      true,
    );
    const gone = new Set([...proofs.map((proof) => proof.row), ...done.committed, ...done.withdrawn]);
    const kept = new Set(rows.filter((row) => !gone.has(row.id) && (row.head === null || row.head === head)).map((row) => row.path));
    const candidates = history === null ? rows.filter((row) => !kept.has(row.path)) : rows;
    const reverted = yield* left(yield* revertible(checkout, head, byPath(candidates), gone, touched), true);
    const ended = new Set([...done.committed, ...done.withdrawn, ...reverted.withdrawn]);
    yield* unfollowed(
      checkout,
      rows.filter((row) => !ended.has(row.id)),
    );
    yield* debts.owed(checkout, root.path);
    return { committed: done.committed, withdrawn: [...done.withdrawn, ...reverted.withdrawn] };
  });

  const released = Effect.fnUntraced(function* (checkout: RootId, own: readonly StandingRow[]) {
    const ids = new Set(own.map((row) => row.id));
    const asked = [...new Set(own.map((row) => row.path))];
    const judged = yield* Effect.result(holdings.judged(checkout, asked));
    const others = byPath(yield* store.standing(checkout));
    const overwritten: StandingRow[] = [];
    if (judged._tag === 'Failure')
      yield* Effect.logWarning('lines a deleted thread overwrote stay held: whose lines stand there could not be judged', {
        checkout,
        reason: judged.failure.message,
      });
    else
      for (const [path, one] of judged.success) {
        if (one.verdict.verdict !== 'proven') continue;
        const live = new Map((others.get(path) ?? []).map((row) => [row.id, row] as const));
        for (const [id, by] of one.verdict.overwritten) {
          const row = live.get(id);
          if (row !== undefined && row.state === 'held' && !ids.has(id) && by.length > 0 && by.every((other) => ids.has(other)))
            overwritten.push(row);
        }
      }
    const deleted = yield* left(yield* withdrawals(own, 'thread-deleted'), false);
    const covered = yield* left(yield* withdrawals(overwritten, 'overwritten'), true);
    return { committed: [], withdrawn: [...deleted.withdrawn, ...covered.withdrawn] };
  });

  const passes = yield* makePasses({
    work: (checkout) =>
      background
        .run(
          {
            title: 'Settling lines after commits',
            reason: 'Lines that landed in commits or were undone leave their holders.',
            total: null,
          },
          () => Effect.flatMap(placed(checkout), (place) => (place.removed ? vacate(checkout) : passed(checkout, place.root))),
        )
        .pipe(Effect.withSpan('Retirer.pass', { attributes: { 'retirement.checkout': checkout } })),
  });

  const request = (checkout: string) => passes.request(RootId.make(checkout));

  const logged = <A>(work: Effect.Effect<A, RetireFailure>, checkout: string): Effect.Effect<void> =>
    Effect.flatMap(Effect.exit(work), (exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : Effect.logWarning('the retirement pass stopped; the next HEAD move or start takes it up', {
            checkout,
            reason: Cause.pretty(exit.cause),
          }),
    );

  const settle = (checkout: RootId): Effect.Effect<number, RetireFailure> =>
    passes.hold(
      checkout,
      Effect.flatMap(placed(checkout), (place) => (place.removed ? Effect.as(vacate(checkout), 0) : debts.owed(checkout, place.root.path))),
    );

  const listen = Effect.fnUntraced(function* () {
    if (listening) return;
    listening = true;
    const unclosed = commands.onClose(request);
    const uncleaned = holdings.changed((change) =>
      change.changed.some((holding) => holding.git === null) ? request(change.checkout) : Effect.void,
    );
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        unclosed();
        uncleaned();
      }),
    );
  });

  const follow = (checkout: RootId): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (followed.has(checkout)) return Effect.void;
      return Effect.gen(function* () {
        const place = yield* Effect.result(roots.checked(checkout));
        if (place._tag === 'Failure') {
          const removed = yield* Effect.result(roots.removed(checkout));
          if (removed._tag === 'Success' && removed.success) return yield* logged(passes.hold(checkout, vacate(checkout)), checkout);
          return yield* Effect.logWarning('the retirement driver cannot place a checkout, so it does not follow its HEAD', {
            checkout,
            reason: removed._tag === 'Failure' ? removed.failure.message : place.failure.message,
          });
        }
        const root = place.success.path;
        yield* claiming.withPermit(
          Effect.gen(function* () {
            if (followed.has(checkout)) return;
            const watching = yield* Scope.fork(scope);
            followed.set(checkout, watching);
            yield* Effect.forkIn(
              Stream.runForEach(checkouts.headObserved(root), () => request(checkout)),
              watching,
            );
          }),
        );
      });
    });

  return {
    ...Retirement.of({
      landing: (fact) => store.landing(fact.checkout, fact.commit, fact.tree, fact.landed ?? []),
      pass: passes.pass,
      lease: passes.lease,
      formed: (checkout, ids) =>
        passes.hold(
          checkout,
          left(
            ids.map((id) => ({ id, state: 'withdrawn', reason: 'formed', span: null }) as const),
            false,
          ),
        ),
      settle,
      gone: (checkout) =>
        passes.hold(
          checkout,
          Effect.gen(function* () {
            const read = yield* Effect.exit(Effect.flatMap(roots.read(checkout), (root) => passed(checkout, root)));
            const last = Exit.isSuccess(read)
              ? read.value
              : yield* Effect.as(
                  Effect.logWarning('a checkout going away could not have its last commits read; its rows leave as checkout-gone', {
                    checkout,
                    reason: Cause.pretty(read.cause),
                  }),
                  NOTHING,
                );
            const vacated = yield* vacate(checkout);
            return { committed: last.committed, withdrawn: [...last.withdrawn, ...vacated.withdrawn] };
          }),
        ),
    }),
    follow,
    logged,
    deleted: Effect.fnUntraced(function* (projectId: number, threadId: string) {
      const rows = yield* store.ofThread(projectId, threadId);
      const committed: string[] = [];
      const withdrawn: string[] = [];
      const byCheckout = new Map<string, StandingRow[]>();
      for (const row of rows) byCheckout.set(row.checkout, [...(byCheckout.get(row.checkout) ?? []), row]);
      for (const [checkout, own] of byCheckout) {
        const done = yield* passes.hold(RootId.make(checkout), released(RootId.make(checkout), own));
        withdrawn.push(...done.withdrawn);
        committed.push(...done.committed);
      }
      return { committed, withdrawn };
    }),
    start: Effect.gen(function* () {
      yield* listen();
      const orphans = yield* store.orphaned();
      const byCheckout = new Map<string, StandingRow[]>();
      for (const row of orphans) {
        const group = byCheckout.get(row.checkout);
        if (group === undefined) byCheckout.set(row.checkout, [row]);
        else group.push(row);
      }
      for (const [checkout, rows] of byCheckout)
        yield* logged(passes.hold(RootId.make(checkout), released(RootId.make(checkout), rows)), checkout);
      for (const checkout of yield* store.checkouts()) yield* follow(RootId.make(checkout));
      for (const checkout of yield* store.indebted()) yield* logged(settle(RootId.make(checkout)), checkout);
    }),
  };
});
