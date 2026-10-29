---
id: 01a0e976-db65-73a7-815f-cb29de7e92f6
title: Per-path durable import-closure index, so `blocking-calls` (and every closure-reading builtin) judges a one-file landing at a cost that follows the change
ord: 91
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e519-2c8e-7307-95c7-b14b4134178c",
    "status": "done"
  }
---
Build in `restructure`; run its SQLite integration tests only at merge, where those tests are allowed. `operations-registered`, `answer-declared` and `held-resources` are gate candidates once every remaining unjudged site has a reason and removing task. `blocking-calls` stays off gate until this task lands and is then only a gate proposal, never enabled as part of this task.

As built on `restructure`, the pure rank-support algorithm lives in the existing core-floor `imports.ts` rather than a new top-level `reach.ts`, because that new file would require an `enforce_rule` floor change forbidden in this wave. The normal worker cache path and HEAD parity were measured; transactional failure/restart/eviction cases await [[9b6726e6]] at merge. Pattern changes list candidate directories within their glob literal prefixes; a pattern with no narrowing prefix still scans repository directories, not all files.

Recommendation: replace the monolithic `MemoValue.closure` with a per-(params, checkout) **reach index**: one SQLite row per reached file plus reverse-edge and "watch" rows, a single head `{tree, generation}` that only ever advances to a *base* tree, and a pure rank-support update algorithm in code-facts. Built trees are judged as an in-memory overlay that is never written, so rejected landings leave nothing behind. Per-landing cost becomes O(changed paths + re-resolved importers + newly reached + support-lost region) point reads/writes; the one cost that cannot be bounded by the landing is cold bootstrap (flagged in §8).

Read at this worktree (restructure) on 2026-09-28: blockingCalls.ts 429 lines, imports.ts, tree.ts, memo.ts, run.ts, inspecting.ts, cache/store.ts, cache/record.ts, js resolve.ts/workspace.ts, judge.ts. Nothing changed, nothing run.

## 1. What the provisional index gets wrong (evidence)

1. **`updateImportClosure` is O(descendants), not O(touched).** imports.ts:83 and :89 take `reachableFrom(forward, file)` before and after for every changed file, and :92-101 scan reverse edges of that whole set. Editing `http/main.ts` (the root) or any hub makes `affected` the entire closure. Persisting rows per path does not fix this, because the algorithm would still read every descendant's row.
2. **Whole-graph rebuilds on the landing path.** blockingCalls.ts:335 runs `createImportClosure(root, before.edges)` on any edge change; `heldClosure` (:226-227) rebuilds from all stored edges on each restore; `saveClosure` (:234-242) serializes every edge for every built tree; a manifest change runs a full `computeClosure` (:417-421).
3. **Resolution shadowing is missed.** `resolveRelative` (resolve.ts:31) takes the first hit of `base, compiled, .ts, .tsx, .svelte, index.ts`. Adding `x.ts` while `./x` resolves to `x/index.ts` changes an existing edge, but `affected` (:410-416) only revisits reverse edges of deleted paths and `missing` targets. The `startsWith(target + '.')` test is a heuristic, where exact probe sets are needed.
4. **Workspace resolution scans the whole listing per call.** `workspaceMembers` (workspace.ts:137) walks `tree.paths()`, and `importEdges` builds a new workspace on every call. `changedClosure.refresh` calls it once per refreshed file, so the cost is O(refreshed × listing).
5. **Snapshot identity is the commit** (inspecting.ts:270 `snapshot: side.commit`). The built commit and the landed commit need not share an id even when their trees are identical, so saved built closures are orphans.
6. **The `entry` table cannot hold an index.** `cacheWrites` silently drops the oldest staged writes over `staging` (record.ts:22-25), and `flush` evicts single rows by LRU (store.ts:84-88). A missing reverse or watch row means a missed invalidation, which is a silently wrong verdict.
7. **The worker listing is O(repo) per job.** `checks/blocking-calls.server.json` has `base: ""`, so `lists()` includes `''`, `pathspecsOf` returns `[]`, and `git ls-tree -r` runs over the whole repository for base *and* built on every new job (inspecting.ts:88-94, 439).

## 2. Owners

| Layer | Owns | Must not |
|---|---|---|
| `packages/code-facts/src/reach.ts` (new, pure) | rank-support reach algorithm over a row port; overlay | touch SQLite, git, params |
| `packages/code-facts/src/tree.ts` + `languages/js/{resolve,workspace}.ts` | `fileEdges`: edges **plus the exact facts consulted** (absent probes, package names); incremental workspace members | cache across files without the probes |
| `apps/tagma/inspection/src/node/blockingCalls.ts` | `derive` (boot exclusion, `js.parses`, base-prefix unjudged), index key, `affected`/`read` | hold whole graphs; write rows directly |
| `apps/tagma/inspection/src/node/memo.ts` | `ReachIndex` port type; staged writes in `memoWrites`; commit point | know storage |
| `apps/tagma/server/src/enforcement/cache/store.ts` | SQLite tables, CAS transaction, whole-index eviction | per-row LRU on index rows |
| `apps/tagma/server/src/enforcement/inspecting.ts` (worker) | tree ids, `diff-tree`, lazy listing, advancing head to base | touch main-process modules or the `JudgeAsk` wire |

The server main process (`Inspections.ts`, `asks.ts`, check/judge callers) does not change. Everything runs in modules the inspection worker loads, so a new worker (after the 60 s idle exit) picks it up.

## 3. Types (code-facts, pure)

```ts
// packages/code-facts/src/tree.ts
export type Probed = {
  readonly edges: readonly ImportEdge[];
  readonly unresolved: readonly Unresolved[];
  readonly absent: readonly string[];   // paths has() answered false before a hit, or all candidates on a miss
  readonly packages: readonly string[]; // bare package names handed to the workspace, hit or miss
};
export function fileEdges(tree: Tree, file: string, reads: ImportReads, adapters: Adapters, workspace: Workspace | null): Probed;
// importEdges stays as a loop over fileEdges for old callers.

// adapter.ts: Workspace gains a traced resolve; the door cache stores probes with the result
export type Traced = { readonly resolution: Resolution | null; readonly absent: readonly string[]; readonly package: string };
export type Workspace = { readonly manifest: string; readonly resolve: (s: string) => Resolution | null; readonly traced: (s: string) => Traced };
// Relative resolution is traced by giving adapter.resolve a has()-recording tree. Exact, because resolve is a pure function of has().

// languages/js/workspace.ts: members as data, updated per manifest
export type MemberSet = {
  readonly manifest: string | null;
  readonly patterns: readonly string[];
  readonly members: readonly (readonly [dir: string, name: string | null, object: string])[];
};
export function membersOf(tree: Tree, from: string): MemberSet;   // bootstrap: needs paths() (or tree.matching)
export function membersDelta(held: MemberSet, tree: Tree, from: string, manifests: readonly string[]): { readonly set: MemberSet; readonly names: readonly string[] };
export function workspaceFrom(set: MemberSet, tree: Tree, conditions: readonly string[]): Workspace | null; // reads a member manifest only when its name is asked
// Tree gains an optional `matching?: (globs: readonly string[]) => Iterable<string>` for the pattern-change rescan.

// packages/code-facts/src/reach.ts
export type ReachNode<N> = {
  readonly object: string;
  readonly rank: number;            // root 0; invariant: some reached source s has rank(s) < rank
  readonly out: readonly string[];  // tracked targets, all reached
  readonly watch: readonly string[];// 'p:<path>' absent probes, 'k:<name>' package names
  readonly note: N;                 // inspection-owned per-file payload (unjudged)
};
export type ReachRows<N> = {
  readonly node: (path: string) => ReachNode<N> | undefined;
  readonly sources: (path: string) => Iterable<string>;   // reached files with an edge to path
  readonly watchers: (key: string) => Iterable<string>;
};
export type Derived<N> = { readonly out: readonly string[]; readonly watch: readonly string[]; readonly note: N } | null; // null: not a tracked node
export type ReachChange = {
  readonly paths: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[];
  readonly packages: readonly string[];
};
export type ReachDelta<N> = {
  readonly nodes: ReadonlyMap<string, ReachNode<N> | null>; // null = drop
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly derived: readonly string[];  // existing nodes re-resolved
};
export function reachDelta<N>(rows: ReachRows<N>, root: string, change: ReachChange, derive: (path: string) => Derived<N>, object: (path: string) => string | undefined): ReachDelta<N>;
export function overlay<N>(rows: ReachRows<N>, delta: ReachDelta<N>): ReachRows<N>;
```

## 4. Algorithm: `reachDelta`

1. **Dirty set D.** A modified or deleted path that is a node; `sources(p)` of a deleted p; `watchers('p:'+p)` of an added p; `watchers('k:'+n)` for each changed package name. The root, when added, is grown at rank 0; when deleted or excluded, everything drops.
2. **Re-derive D.** Call `derive` for each dirty file and diff its old and new `out`.
3. **Grow.** BFS from each added edge f→t where t has no node: rank(t) = rank(f)+1, derive t, continue. The result N is `added`. An added edge to an existing node changes no rank.
4. **Prune and reattach.** Take the targets of removed edges and the dropped nodes.
   - t stays if some source s outside the lost set has rank(s) < rank(t); that check is O(in-degree).
   - Otherwise t is suspect, and suspicion propagates to children that have no lower-rank supporter outside S.
   - A multi-source BFS inside S, seeded from any reached source outside S at rank(s)+1, assigns new ranks.
   - Nodes of S left unassigned are removed.
   - Nodes outside S keep their ranks, so their support is untouched.
   - Strict rank decrease makes cyclic self-support impossible.
5. **Cost.** O(|D| derives + |N| + |S| + incident degrees) point reads. |N| and the removed nodes are the answer itself. The part of |S| that is not removed (nodes that stay reachable at a higher rank) is the only term beyond the output. It is small wherever importers are redundant; on a pure chain it equals the chain below the cut.

`updateImportClosure`/`createImportClosure` stay only as the in-memory reference for tests, or are deleted once `reach.ts` replaces them.

## 5. Storage (server store; same cache file; no per-row LRU)

```sql
CREATE TABLE IF NOT EXISTS reach_index (id INTEGER PRIMARY KEY, key TEXT UNIQUE NOT NULL, tree TEXT NOT NULL,
  generation INTEGER NOT NULL, members TEXT NOT NULL, bytes INTEGER NOT NULL, touched INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS reach_node  (idx INTEGER, path TEXT, object TEXT, rank INTEGER, body TEXT, PRIMARY KEY(idx, path)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS reach_edge  (idx INTEGER, target TEXT, source TEXT, PRIMARY KEY(idx, target, source)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS reach_watch (idx INTEGER, key TEXT, file TEXT, PRIMARY KEY(idx, key, file)) WITHOUT ROWID;
```

- `body` holds `{out, watch, note}`. Deleting a node reads its body and deletes its edge and watch rows by primary key, so no second index is needed.
- `key` = `blocking-calls/reach/v2\0${js.version}\0${closureKey(params)}\0${slot}`, where `slot` = `ask.root`, the checkout. Worktrees keep separate heads, so heads do not ping-pong across branches.
- `members` is the `MemberSet` JSON. It is O(workspace packages), not O(closure).
- No `user_version` bump is needed (`CREATE IF NOT EXISTS`). An old worker ignores the tables, and the old `memo:` closure rows age out of `entry`.

Port (inspection memo.ts):

```ts
export type ReachHead = { readonly tree: string; readonly generation: number };
export type ReachIndex<N> = ReachRows<N> & {
  readonly head: ReachHead | undefined;
  readonly members: MemberSet | undefined;
  readonly stage: (from: ReachHead | undefined, to: string, delta: ReachDelta<N>, members: MemberSet) => void;
};
export type InspectionMemo = { get; set; stats?; readonly reach?: <N>(key: string) => ReachIndex<N> };
// memoWrites: reach(key) wraps reads and buffers stage(); commit() applies it after the entry writes.
// store: readonly reach: { open(key): ReachIndex; apply(key, from, to, delta, members): 'applied' | 'moved' | 'full' }
```

### Transaction points

- **R: one read snapshot per work round.** `settled` opens a deferred `BEGIN` before `work(...)` and ends it after. WAL gives every point read in the round one consistent snapshot, even while another lane writes.
- **W: advance.** At the existing commit point (inspecting.ts:363, `memo.commit()`, reached only when no text or probe is missing), `apply` runs one `BEGIN IMMEDIATE`:
  - `UPDATE reach_index SET tree=?, generation=generation+1 … WHERE key=? AND generation=?`; zero rows means `moved`, so roll back and drop the delta (the next ask redoes the work from the new head);
  - write the node, edge and watch rows, `members` and `bytes`;
  - commit.
  A new index inserts its `reach_index` row in the same transaction.
- **E: whole-index eviction.** On `SQLITE_FULL`, or when the sum of `bytes` passes `budget/2` (`entry` already self-caps at `budget/2`, store.ts:84), delete the least recently touched *whole* index in its own transaction and retry W once. A partial index never exists.
- **No transaction for built.** It is an `overlay(rows, delta)` held in the job's WeakMap for `read`, then discarded.

## 6. Commit and invalidation model

- **Snapshot identity = tree id.** The worker runs one `git rev-parse B^{tree} C^{tree}` per job and sets `Tree.snapshot` to the tree id (inspecting.ts:270 today uses the commit; run.ts:98 is the CLI equivalent).
- **Head advances only to a base.** A judge (B, C):
  1. If `head.tree ≠ tree(B)`: `git diff-tree -r -z --no-renames head B` → `ReachChange` → `reachDelta` → stage → W. If the head's tree object is gone, the diff fails and the index cold-rebuilds.
  2. `git diff-tree -r -z --no-renames B C` → overlay (use the diff, not `ask.paths`, which is rule-narrowed).
  3. `affected` = (`derived` ∪ `added`) − changed, filtered by `selects`.
  4. `read(base)` and `read(built)` in change scope ask `node(path)`, never a whole reached set.
- **Rejected landing.** Nothing about C was written. The next base is still B, or the new HEAD, whose diff from the head is the landed change.
- **Accepted landing.** The next ask's base tree equals C's tree, and the diff re-derives only C's change. Deriving twice costs a constant factor, and parse rows (`parse:` keyed by blob) make the second derive cheap. Storing the overlay under C's tree and promoting it is an optional later step.

| Event | Exact handling |
|---|---|
| Import edited | the file is dirty; its `out` diff feeds grow and prune |
| Cycle loses its entry | strict ranks make the whole cycle suspect with no outside source, so it is removed |
| Alternate parent | lower-rank source outside the lost set; O(in-degree) |
| Add resolves a prior miss or shadows a hit | `watchers('p:'+path)`: absent probes are recorded up to the hit |
| Delete of a reached target | `sources(p)` re-derive (new unjudged), and p's node drops |
| Member `package.json` add/delete/edit | `membersDelta` → changed names → `watchers('k:'+name)` |
| Root `workspaces` patterns edit | `membersDelta` rescans manifests via `tree.matching(globs)` (pathspec-limited `ls-tree`) and diffs names |
| Boot/params/`js.version` change | new key, so a new index (cold) |
| Worker restart | nothing in memory is required; the first ask diffs head→base |
| `entry` eviction (parses/memos) | re-parse only; index unaffected |
| Index eviction, damaged file (`safely` reset), gc'd head | cold rebuild |
| Two lanes race (landing and merge share the file) | generation CAS; the loser discards its delta |

## 7. Worker listing (inspecting.ts)

- `Listing` becomes an interface: `object(path)`, `size(path)`, optional `paths()`.
- For `judge` asks whose builtin does not prefetch (blocking-calls declares `prefetch: false`), the **lazy listing** answers in this order:
  1. the `diff-tree` entries for C;
  2. head node objects for B;
  3. a job-scoped known map.
- An unknown path joins an `unknown` set and gets a provisional `false`. The round is discarded exactly like `missing` texts today (inspecting.ts:360-377), and the next round batches `git ls-tree -z -l <tree> -- :(literal)p…`.
- The number of rounds is bounded by the depth of the newly reached region.
- Full `ls-tree` stays for reach/plan/slice, for prefetching builtins, and for bootstrap.
- Flag: the other gate builtins (modules, names, platforms) still list the whole repo per job. That is outside this design, and it still violates the operator's mandate.

## 8. Bounds that cannot be met

- **Cold bootstrap is O(closure parse + one listing + rows written).** It happens on the first judge per (params, checkout), after whole-index eviction, cache reset, params or adapter version change, or when the head tree was garbage-collected. No design avoids it, since the first closure must be read once.
- **Mitigation without a new driver.** The `reach` lane already walks the whole closure. Have `reach` commit its result as the index at W, so a reach run of HEAD pre-warms it; otherwise one landing pays the cost once. Seeding a new checkout slot from the same key's most recent slot (`INSERT…SELECT`, then diff) avoids re-parsing but is still O(index rows).
- **Root `workspaces` pattern edits** cost O(manifests matching the globs).
- **The non-removed part of the suspect region S** (nodes whose support must be re-ranked) is bounded by the graph, not by the landing. It is inherent to exact reachability under edge deletion.

## 9. Tests (all unit, in memory; no SQLite, git or disk)

**code-facts `reach.test.ts`** (an array-backed `ReachRows` fake counting `node`/`sources` calls):
- root edit adding one import → only the new subtree is read (count = |N| + 1), never the whole closure;
- removing one of two parents → one `sources` read, nothing removed;
- a cycle cut from root → both removed;
- a cycle keeping an outside parent → kept, ranks strictly decreasing along support;
- a chain cut mid-way → exact removed tail;
- grow-then-prune with an edit that swaps an import for a new file importing the old target → the old target is kept, not removed and re-derived;
- a property test on random DAGs and cycles: `reachDelta` applied to the rows equals a fresh BFS of the new graph (reached set and rank invariant).

**code-facts `tree.test.ts` / js `resolve.test.ts` / `workspace.test.ts`:**
- `fileEdges` reports absent probes up to the hit;
- adding `x.ts` shadows `x/index.ts` (the probe is present);
- `traced` keeps its probes on a door-cache hit;
- `membersDelta` names only added, removed and renamed or re-exported members.

**inspection `blockingCalls.test.ts`** (an in-memory `ReachIndex` in `memoWrites`):
- a shadowing add reports the importer;
- a member manifest edit re-resolves only its importers;
- a rejected built leaves the head and rows unchanged;
- an advance whose generation moved is dropped;
- after restart (a new memo over the same rows), the next base diff re-derives only the landed files;
- a one-file edit stages O(1) node rows;
- replace the current "reuses an exact-snapshot closure memo" test, which pins the monolithic `closure.root`.

**server `cache/store.itest.ts`** (SQLite is disk, so this is an integration test):
- CAS `moved`;
- whole-index eviction leaves no orphan edge or watch rows;
- `SQLITE_FULL` rolls back to the prior head;
- index rows survive `entry` LRU pressure.

## 10. Build order

1. code-facts `reach.ts` with its tests; `fileEdges`/`traced`/`MemberSet` with their tests.
2. inspection: the `ReachIndex` port in memo.ts, then blockingCalls on `reachDelta` + `overlay`. Delete `computeClosure`, `changedClosure`, `heldClosure`, `saveClosure`, `ClosureIndex` and the `closure` field of the record schema.
3. server store: the tables and `apply` with CAS; eviction.
4. worker: tree ids, `diff-tree` advance, lazy listing, R/W transaction points.
5. `reach` commits its closure as the index (pre-warm).

Observability: the existing `MemoStats` gains counters for derived, added, removed and suspect nodes, plus rows read, per job, so a bench can show per-landing rows ≈ touched.

Performance lens follow-ups: persist blob text by object identity across asks instead of re-fetching unchanged bytes; avoid rewalking the same fetched prefix each lazy round; stop cloning or serializing the whole closure on import edits. A cold CLI sample and a server-warm landing are distinct measurements, and the latter must be shown with per-landing row counts. The listing memo is keyed by tree identity before this task, but `blocking-calls` still needs the lazy per-path listing in §7.
